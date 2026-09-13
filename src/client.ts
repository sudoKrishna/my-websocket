import net from "node:net";

const socket = net.createConnection({
    host : "localhost",
    port: 8080,
})

socket.on("connect", () => {
    console.log("Connected to server"),

    socket.write("hello")
})

socket.on("data" , (data) => {
    console.log("server sent:", data)
})

socket.on("close",  () => {
    console.log("connection close")
})