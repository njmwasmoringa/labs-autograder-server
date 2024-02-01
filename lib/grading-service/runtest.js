
var canvasAPI = require("../canvas");
var { spawn } = require("child_process");
var path = require("path");

const basePath = path.resolve(__dirname);
const script = path.join(basePath, '../run-test.sh');

module.exports = (userId, token, wsClient) => {
    return (course, submission) => {
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

                        if(!responseText.startsWith("{")){
                            lastMsg = responseText;
                            return;
                        }

                        let comment, status;

                        const report = JSON.parse(responseText.replace(/(0\.)(.[0-9]*)/g, '"$1$2"').replace(/(\: 0,)/g, ': "0",'));

                        if (lastMsg && lastMsg.includes("js_test_report")) {

                            

                            if (report.failures.length === 0) {
                                status = "complete";
                                comment = `Excellent work, All tests passed\n\n✓${report.passes.map(r => r.fullTitle).join('\n✓')}`;
                            }
                            else {
                                status = "incomplete";
                                comment = `Please fix the following issues \n\nx ${report.failures.map(r => r.fullTitle).join('\nx ')}\n`;
                            }

                        }

                        if (lastMsg && lastMsg.includes("react_test_report")) {

                            // console.log(report);

                            let passed = [], failed = [];
                            report.testResults.forEach(result => {
                                if (result.status !== "passed") failed = failed.concat(result.assertionResults);
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

                        if (lastMsg && lastMsg.includes("python_test_report")) {

                            if (report.summary.passed === report.summary.total) {
                                status = "complete";
                                comment = `Excellent work, All tests passed\n\n
                                ✓ ${report.tests.map(r => `${r.nodeid} -> ${r.outcome}`).join('\n✓ ')}`;
                            }
                            else {
                                status = "incomplete";
                                comment = `Please fix the following issues \n\n
                            x ${report.tests.map(r => `${r.nodeid} -> ${r.outcome}`).join('\nx ')}`;
                            }
                        }

                        if (comment && status) {
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
                            }).catch(e=>{
                                console.log(e.message);
                            });
                        }

                        lastMsg = responseText;

                    }
                    catch (e) {
                        console.log(e.message);
                        console.log(responseText.replace(/(0\.)(.[0-9]*)/g, '"$1$2"'))
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
}