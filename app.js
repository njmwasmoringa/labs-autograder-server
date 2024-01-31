var createError = require('http-errors');
var express = require('express');
var {fork} = require('child_process');
const path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');

var app = express();
var cors = require('cors');

/* var client = require("socket.io-client");
var socket = client.connect("http://localhost:3130");
socket.emit("test", "foo"); */

var graddingServices = {};
function addGradingService(user, token, username){
  const connect = ()=>fork(path.join(__dirname, "/lib/grading-service/index.js"), [user, token, username]);
  graddingServices[user] = connect();
  graddingServices[user].on("message", (msg)=>console.log(msg));
  graddingServices[user].on("exit", (msg)=>{
    console.log(user, "Existed");
    connect();
  });
}

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(cors({
  origin: ["https://autograder.picpazz.com","http://localhost:3045"]
}));

app.use('/', indexRouter);
app.use('/users', usersRouter, (user, req, res, next) => {

  try{

    if(!graddingServices[user.id]){
      addGradingService(user.id, req.body.authtoken, user.name);
      graddingServices[user.id]
      /* .send(JSON.stringify({
        action:"serviceStatus"
      })); */
    }
  
    res.status(200).json(user);

  }
  catch(e){
    next(e);
  }
});

app.use('/grade', async (req, res, next)=>{
  try{

    if (!req.headers.authorization || req.headers.authorization === "") {
      return res.status(401).json({ message: "Unauthorized" })
    }

    const authtoken = req.headers.authorization.split(" ").pop();
    
    const {course, assignments, user} = req.body;
    if(!graddingServices[user]){
      addGradingService(user, authtoken);
    }
    
    if(graddingServices[user]){
      graddingServices[user].send(JSON.stringify({
        action:"grade",
        assignments,
        course
      }));
      res.json({message:"Yes sir/madam"})
    }
    else{
      res.json({message:"Who are you"});
    }

  }
  catch(e){
    next(e);
  }
});

/* app.use('/status/:uid', async (req, res, next)=>{
  try{
    const authtoken = req.headers.authorization.split(" ").pop();
    graddingServices[req.params.uid].send(JSON.stringify({
      action:"serviceStatus"
    }));
  }
  catch(e){
    next(e);
  }
}); */

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

process.on("beforeExit", ()=>{
  Object.values(graddingServices).map(cp=>cp.kill());
});


module.exports = app;
