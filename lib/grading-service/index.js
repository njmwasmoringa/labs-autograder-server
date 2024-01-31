
var canvasAPI = require("../canvas");
var { io } = require("socket.io-client");
var { spawn } = require("child_process");
var path = require("path");

const userId = process.argv[2];
const token = process.argv[3];
const owner = process.argv[4];

const basePath = path.resolve(__dirname);
const script = path.join(basePath, 'run-test.sh');

let serviceState = "idle";
let quuedProcess = [];
let scheduledJobs = {};

let timeUntilNextAutoGrade = 6 * 60 * 60 * 1000; //after 6 hours // 
const broadcastStatusAfter = 30000; // 30 seconds //
const numberOfConcarentTests = 5;
let timer = broadcastStatusAfter;

const wsClient = io("https://autograderapi.picpazz.com"); // io("http://localhost:3130"); //
function setStatus(status) {
    serviceState = status;
    console.log(owner, ' is ', status);
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

const runTests = require("./runtest")(userId, token, wsClient);

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
                        await Promise.allSettled(submissions.splice(0, numberOfConcarentTests)
                            .map(submission => runTests(message.course, submission)))
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
        console.log(owner, " is idle, running stuff now");
        Object.values(scheduledJobs).forEach(msg => doWork(msg));
    }

}, broadcastStatusAfter);

process.on("message", (msg) => {
    switch (msg.action) {
        case "serviceStatus":
            process.send(serviceState)
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