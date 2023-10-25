const WSServer = require('socket.io');

module.exports = (server, corsOptions) => {
    const io = WSServer(server, { cors: corsOptions });
    var ioClients = {};

    io.on("connection", (socket) => {
        console.log("Websocket Connected", socket.id);

        socket.on("grade", ({usercourse, payload})=>{
            // console.log(usercourse)
            socket.join(usercourse);
            io.to(usercourse).emit("grade",{
                socket:socket.id,
                ...payload
            });
        });

        socket.on("serviceState", ({userService, status})=>{
            // console.log(usercourse)
            socket.join(userService);
            io.to(userService).emit("serviceState", {status});
        });
    });

    return { io, ioClients };

}