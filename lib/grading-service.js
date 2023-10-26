
var canvasAPI = require("./canvas");
var { io } = require("socket.io-client");
var { spawn } = require("child_process");
var path = require("path");

const userId = process.argv[2];
const token = process.argv[3];

const basePath = path.resolve(__dirname);
const script = path.join(basePath, 'run-test.sh');

let serviceState = "idle";
const quuedProcess = [];

const wsClient = io("http://localhost:3130");
function setStatus(status) {
    serviceState = status;
    console.log(status);
    wsClient.emit("serviceState", {
        userService: `${userId}-servicestate`,
        status
    });
}
setStatus("idle");
setInterval(() => {
    wsClient.emit("serviceState", {
        userService: `${userId}-servicestate`,
        status: serviceState
    });
}, 30000);

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

                    if (lastMsg && lastMsg.includes("js_test_report")) {
                        try {
                            const report = JSON.parse(responseText);
                            let status, comment;
                            if (report.failures.length === 0) {
                                status = "complete";
                                comment = `Excellent work, All tests passed\n\n✓${report.passes.map(r => r.fullTitle).join('\n✓')}`;
                            }
                            else {
                                status = "incomplete";
                                comment = `Please fix the following issues and consider re-submitting this lab\n\nx ${report.failures.map(r => r.fullTitle).join('\nx ')}\n`;
                            }

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
                        catch (e) {
                            console.log("sending grade error", e.message);
                            spawnedTest.kill();
                            rj(e);
                        }
                    }

                    lastMsg = responseText;

                }
                catch (e) {
                    console.log(e.message);
                    spawnedTest.kill();
                    rs(e);
                }
            }

        });

        spawnedTest.stdout.on('end', data => {
            console.log("End");
            console.log(data);
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
                    let assignmentIds = [...instructions.assignments];

                    const testAssignmentSubmissions = async ()=>{

                        console.log("Assignments: ", assignmentIds.length);
                        const assignmentId = assignmentIds.splice(0, 1)[0];
                        
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

                        if(assignmentIds.length > 0){
                            await testAssignmentSubmissions();
                        }
                        
                    }

                    if(assignmentIds.length > 0){
                        await testAssignmentSubmissions();
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

            if (quuedProcess.length > 0) {
                doWork(quuedProcess.splice(0, 1)[0]);
            }
            else {
                setStatus("idle");
            }
        }
        else {
            quuedProcess.push(msg);
        }
    }
    catch (e) {
        // console.log(e);
        setStatus("idle");
        doWork(msg);
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
    console.log(msg);
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

process.on("message", (msg) => {
    switch (msg.action) {
        case "serviceStatus":

            break;
        default:
            console.log(msg);
            doWork(msg);
            break;
    }
});
process.on("exit", () => {
    runningAssignements.forEach(p => p.kill());
});