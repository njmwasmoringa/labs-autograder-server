var express = require('express');
var router = express.Router();
var canvasAPI = require("../lib/canvas");

/* GET home page. */
router.get('/', function (req, res, next) {
  res.render('index', { title: 'Express' });
});

router.get('/courses', async function (req, res, next) {

  try {
    const authtoken = req.headers.authorization.split(" ").pop();
    const response = await canvasAPI.get(`/courses?access_token=${authtoken}`);
    res.json(response.data);
  }
  catch (e) {
    res.status(401).json({ message: "Unauthorized" });
  }

});

router.get('/submissions/:course_id', async (req, res, next) => {

  try {
    const authtoken = req.headers.authorization.split(" ").pop();
    let endPoint = `/courses/${req.params.course_id}/students/submissions`;
    endPoint += `?student_ids[all]&per_page=100&workflow_state=${req.query.workflow || 'submitted'}`;
    endPoint += `&include[]=assignment&include[]=user&include[]=submission_comments&order_direction=descending`;
    endPoint += `&${req.query.assignments.split(",").map(aid => `assignment_ids[]=${aid}`).join('&')}`
    const response = await canvasAPI({
      url: endPoint,
      headers: {
        Authorization: `Bearer ${authtoken}`
      }
    });
    res.json(response.data);
  }
  catch (e) {
    res.status(401).json({ message: "Unauthorized" });
  }
  ///api/v1/courses/:course_id/students/submissions
});

router.get('/assignments/:course_id', async (req, res, next) => {

  try {
    const authtoken = req.headers.authorization.split(" ").pop();
    let endPoint = `/courses/${req.params.course_id}/assignments?per_page=1000`;
    const response = await canvasAPI({
      url: endPoint,
      headers: {
        Authorization: `Bearer ${authtoken}`
      }
    });
    res.json(response.data);
  }
  catch (e) {
    res.status(401).json({ message: "Unauthorized" });
  }
  ///api/v1/courses/:course_id/students/submissions
});

router.get('/studentprogress/:course_id', async (req, res, next) => {
  try {
    const authtoken = req.headers.authorization.split(" ").pop();
    const response = await canvasAPI({
      url: `/courses/${req.params.course_id}/bulk_user_progress`,
      headers: {
        Authorization: `Bearer ${authtoken}`
      }
    });

    res.json(response.data);

  }
  catch (e) {
    res.status(401).json({ message: e.message })
  }
});

module.exports = router;
