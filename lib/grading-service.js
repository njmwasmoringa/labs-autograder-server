
var canvasAPI = require("./canvas");
var { io } = require("socket.io-client");
var { spawn } = require("child_process");
var path = require("path");

const userId = process.argv[2];
const token = process.argv[3];

const basePath = path.resolve(__dirname);
const script = path.join(basePath, 'run-test.sh');

let serviceState = "idle";
let quuedProcess = [];
let scheduledJobs = {};

let timeUntilNextAutoGrade = 6 * 60 * 60 * 1000; //after 6 hours // 
const broadcastStatusAfter = 30000; // 30 seconds //
let timer = broadcastStatusAfter;

const wsClient = io("https://autograderapi.picpazz.com"); //"http://localhost:3130"
function setStatus(status) {
    serviceState = status;
    console.log(status);
    wsClient.emit("serviceState", {
        userService: `${userId}-servicestate`,
        status
    });
}

function scheduleJobs(msg) {
    if (msg.course in scheduledJobs) {
        scheduledJobs[msg.course].assignments = [
            ...new Set(scheduledJobs[msg.course].assignments.concat(msg.assignments))
        ];
    }
    else {
        scheduledJobs[msg.course] = msg;
    }
}

function runTests(course, submission) {

    return new Promise((rs, rj) => {
        const spawnedTest = spawn("bash", [script, submission.url.split("/").slice(0, 5).join("/")]);

        spawnedTest.stdin.setDefaultEncoding("utf-8");
        let lastMsg;
        spawnedTest.stdout.on('data', data => {
            const txtDecode = new TextDecoder("utf-8");
            const responseText = txtDecode.decode(data);

            // console.log(responseText);
            if (responseText.indexOf("kill-pry") > -1 || responseText.indexOf('pry') > -1) {
                spawnedTest.stdin.write("exit\n");
            }
            else if (responseText.indexOf("Cloning failed") > -1) {
                spawnedTest.stdin.write("exit\n");
            }
            else if (responseText.indexOf("**stack**ruby**stack**") > -1) {
                wsClient.emit("grade", {
                    usercourse: `${userId}-any`,
                    payload: {
                        submission,
                        course,
                        responseText: "End"
                    }
                });
                rs("end");
                spawnedTest.kill();
                rs(data);
                return;
            }

            /* else if(responseText.indexOf("**stack**react**stack**") > -1){
                console.log("Is a react");
                setTimeout(()=>{
                    spawnedTest.stdin.write("exit\n");
                }, 1000);
            } */

            else {
                try {
                    // console.log(submission.user.name, submission.assignment.name, responseText);
                    // console.log(responseText)
                    // process.send(JSON.stringify({ ...submission, course, responseText }));
                    wsClient.emit("grade", {
                        usercourse: `${userId}-any`,
                        payload: {
                            submission,
                            course,
                            responseText
                        }
                    });

                    let comment, status;

                    if (lastMsg && lastMsg.includes("js_test_report") && responseText.startsWith("{")) {

                        const report = JSON.parse(responseText);

                        if (report.failures.length === 0) {
                            status = "complete";
                            comment = `Excellent work, All tests passed\n\n✓${report.passes.map(r => r.fullTitle).join('\n✓')}`;
                        }
                        else {
                            status = "incomplete";
                            comment = `Please fix the following issues \n\nx ${report.failures.map(r => r.fullTitle).join('\nx ')}\n`;
                        }

                    }

                    if(lastMsg && lastMsg.includes("react_test_report") && responseText.startsWith("{")){
                        const report = JSON.parse(responseText);

                        // console.log(report);

                        let passed=[], failed=[];
                        report.testResults.forEach(result=>{
                            if(result.status !== "passed") failed = failed.concat(result.assertionResults);
                            else passed = passed.concat(result.assertionResults);
                        });

                        if (failed.length === 0) {
                            status = "complete";
                            comment = `Excellent work, All tests passed\n\n✓ ${passed.map(r => r.title).join('\n✓')}`;
                        }
                        else {
                            status = "incomplete";
                            comment = `Please fix the following issues \n\nx ${failed.map(r => r.failureMessages.join('\n')).join('\nx ')}\n`;
                        }

                    }

                    if(comment && status){
                        canvasAPI({
                            method: 'put',
                            url: `/courses/${course}/assignments/${submission.assignment_id}/submissions/${submission.user_id}`,
                            headers: {
                                Authorization: `Bearer ${token}`
                            },
                            data: {
                                comment: {
                                    text_comment: comment
                                },
                                submission: {
                                    posted_grade: status
                                }
                            }
                        });
                    }

                    lastMsg = responseText;

                }
                catch (e) {
                    console.log(e.message);
                    // spawnedTest.kill();
                    // rs(e);
                }
            }

        });

        spawnedTest.stdout.on('end', data => {
            console.log("End");
            // console.log(data);
            // process.send(JSON.stringify({ ...submission, course, data }));
            wsClient.emit("grade", {
                usercourse: `${userId}-any`,
                payload: {
                    submission,
                    course,
                    responseText: "End"
                }
            });
            rs(data);
            spawnedTest.kill();
        });

        spawnedTest.stderr.on('error', error => {
            console.log(error);
            spawnedTest.kill();
            rj(error);
        });

    });

}

async function doWork(msg) {

    try {
        const message = typeof msg === "string" ? JSON.parse(msg) : msg;
        // console.log(message);
        if (serviceState === "idle") {
            switch (message.action) {
                case "grade":

                    setStatus("busy");

                    let instructions = { ...message }
                    const assignmentId = instructions.assignments[0]; //.splice(0, 1)

                    if (instructions.assignments.length > 1) {
                        quuedProcess = quuedProcess.concat(instructions.assignments.map(aid => ({ ...message, assignments: [aid] })));
                    }

                    console.log("Getting submissions for: ", assignmentId);
                    let endPoint = `/courses/${message.course}/students/submissions`;
                    endPoint += `?student_ids[all]&per_page=100&workflow_state=submitted`;
                    endPoint += `&include[]=assignment&include[]=user&order_direction=descending`;
                    endPoint += `&assignment_ids[]=${assignmentId}`;
                    const response = await canvasAPI({
                        url: endPoint,
                        headers: {
                            Authorization: `Bearer ${token}`
                        }
                    });

                    const submissions = response.data.filter(submission => submission.url.includes("github.com"));
                    wsClient.emit("grade", {
                        usercourse: `${userId}-any`,
                        payload: {
                            submissions,
                            course: message.course
                        }
                    });

                    const workIt = async () => {

                        console.log("Remaining", submissions.length);
                        await Promise.allSettled(submissions.splice(0, 2).map(submission => runTests(message.course, submission)))
                        if (submissions.length > 0) {
                            await workIt();
                        }
                    }

                    if (submissions.length > 0) {
                        await workIt();
                    }

                    break;

                case "manual-grade-submissions":
                    if (message.course && message.assignment && message.users) {
                        setStatus("busy");

                        let endPoint = `/courses/${message.course}/students/submissions`;
                        endPoint += `?${message.users.map(uid => `student_ids[]=${uid}`).join('&')}`;
                        endPoint += `&include[]=assignment&include[]=user&order_direction=descending`;
                        endPoint += `&assignment_ids[]=${message.assignment}`;
                        const response = await canvasAPI({
                            url: endPoint,
                            headers: {
                                Authorization: `Bearer ${token}`
                            }
                        });

                        const submissions = response.data;
                        wsClient.emit("grade", {
                            usercourse: `${userId}-any`,
                            payload: {
                                submissions,
                                course: message.course
                            }
                        });

                        const workIt = async () => {
                            console.log("Remaining", submissions.length);
                            await Promise.allSettled(submissions.splice(0, 2).map(submission => runTests(message.course, submission)))
                            if (submissions.length > 0) {
                                await workIt();
                            }
                        }

                        if (submissions.length > 0) {
                            await workIt();
                        }
                    }

                    break;
            }

            setStatus("idle");
            if (quuedProcess.length > 0) {
                doWork(quuedProcess.splice(0, 1)[0]);
            }

        }
        else {
            quuedProcess.push(msg);
        }
    }
    catch (e) {
        console.log(e.message);
        setStatus("idle");
        if (quuedProcess.length > 0) {
            doWork(quuedProcess.splice(0, 1)[0]);
        }
        // doWork(msg);
    }
}

wsClient.on("connect", (socket) => {
    // console.log(socket);
    console.log("Connected with ", wsClient.id)
    wsClient.emit("grade", { usercourse: `${userId}-any` })
});

wsClient.on("grade", msg => {
    // console.log("runner", msg);
    switch (msg.action) {
        case "run":
            if (msg.assignments) {
                scheduleJobs(msg);
            }
            doWork({ ...msg, action: "grade" });
            break;
        /* case "manual-grade-submissions":
            doWork({ ...msg, action: "manual-grade-submissions" });
            break; */
        case "service-status":
            wsClient.emit("grade", { ...msg, serviceState });
            break;

        default:
            doWork(msg);
            break;
    }
});

wsClient.on("message", msg => {
    // console.log(msg);
    /*  console.log("runner", msg);
     switch (msg.action) {
         case "run":
             doWork({...msg, action:"grade"});
         break;
         case "service-status":
             wsClient.emit("grade", {...msg, serviceState});
         break;
     } */
});

/* wsClient.on("service-status", msg => {
    wsClient.emit("service-status", serviceState);
}); */

wsClient.on("connect_error", (error) => {
    console.log(error);
});


setStatus("idle");
setInterval(() => {
    timer += broadcastStatusAfter;
    wsClient.emit("serviceState", {
        userService: `${userId}-servicestate`,
        status: serviceState
    });

    // console.log("Ruuning scheduled jobs");
    if (timer % timeUntilNextAutoGrade === 0 && serviceState === 'idle') {
        console.log("Am idle, running stuff now");
        Object.values(scheduledJobs).forEach(msg => doWork(msg));
    }

}, broadcastStatusAfter);

process.on("message", (msg) => {
    switch (msg.action) {
        case "serviceStatus":

            break;
        case "grade":
            if (msg.assignments) {
                scheduleJobs(msg);
            }
            doWork(msg);
            break;
        default:
            // console.log(msg);
            doWork(msg);
            break;
    }
});
process.on("exit", () => {
    runningAssignements.forEach(p => p.kill());
});