var express = require('express');
var router = express.Router();
var canvasAPI = require('../lib/canvas');

/* GET users listing. */
router.get('/', function (req, res, next) {
  res.send('respond with a resource');
});

router.post('/auth', async (req, res, next) => {

  if (!req.body.authtoken || req.body.authtoken === "") {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    const response = await canvasAPI(`/users/self?access_token=${req.body.authtoken}`);
    const user = response.data;
    next(user);
  }
  catch (e) {
    res.status(401).json(e);
  }

});

module.exports = router;
