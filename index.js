const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000", // Allow requests from our React app
    methods: ["GET", "POST"]
  }
});

const sessions = {}; // Stores active sessions and their participants
const attendance = {}; // Stores attendance records for each session

const PORT = process.env.PORT || 5000;

app.get('/', (req, res) => {
  res.send('Server is running');
});

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Handle a user joining a session
  socket.on('join-session', ({ sessionId, isTeacher }) => {
    socket.join(sessionId);
    if (!sessions[sessionId]) {
      sessions[sessionId] = { teacher: null, students: [] };
      attendance[sessionId] = []; // Initialize attendance for new session
    }

    if (isTeacher) {
      sessions[sessionId].teacher = socket.id;
      console.log(`Teacher ${socket.id} joined session ${sessionId}`);
      // Notify the teacher of their session ID (for students to join)
      socket.emit('session-created', sessionId);
    } else {
      sessions[sessionId].students.push(socket.id);
      console.log(`Student ${socket.id} joined session ${sessionId}`);
      // Log attendance
      const joinTime = new Date().toISOString();
      attendance[sessionId].push({ studentId: socket.id, joinTime });
      console.log(`Attendance recorded for student ${socket.id} in session ${sessionId} at ${joinTime}`);
      // Notify the teacher about a new student joining
      if (sessions[sessionId].teacher) {
        io.to(sessions[sessionId].teacher).emit('student-joined', socket.id);
      }
    }
    console.log('Current sessions:', sessions);
    console.log('Current attendance:', attendance);
  });

  // Handle WebRTC offer
  socket.on('offer', ({ offer, targetSocketId, sessionId }) => {
    io.to(targetSocketId).emit('offer', { offer, senderSocketId: socket.id, sessionId });
  });

  // Handle WebRTC answer
  socket.on('answer', ({ answer, targetSocketId, sessionId }) => {
    io.to(targetSocketId).emit('answer', { answer, senderSocketId: socket.id, sessionId });
  });

  // Handle ICE candidates
  socket.on('candidate', ({ candidate, targetSocketId, sessionId }) => {
    io.to(targetSocketId).emit('candidate', { candidate, senderSocketId: socket.id, sessionId });
  });

  // Handle real-time messaging (Q&A)
  socket.on('send-question', ({ sessionId, question, studentId }) => {
    // Forward the question to the teacher in the session
    if (sessions[sessionId] && sessions[sessionId].teacher) {
      io.to(sessions[sessionId].teacher).emit('new-question', { question, studentId });
      console.log(`Question from ${studentId} in session ${sessionId}: ${question}`);
    }
  });


  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    // Remove disconnected user from sessions
    for (const sessionId in sessions) {
      if (sessions[sessionId].teacher === socket.id) {
        console.log(`Teacher ${socket.id} left session ${sessionId}. Ending session.`);
        io.to(sessionId).emit('session-ended', sessionId);
        delete sessions[sessionId];
        delete attendance[sessionId]; // Clear attendance when teacher ends session
        break;
      }
      const studentIndex = sessions[sessionId].students.indexOf(socket.id);
      if (studentIndex > -1) {
        sessions[sessionId].students.splice(studentIndex, 1);
        console.log(`Student ${socket.id} left session ${sessionId}`);
        if (sessions[sessionId].teacher) {
          io.to(sessions[sessionId].teacher).emit('student-left', socket.id);
        }
        break;
      }
    }
    console.log('Current sessions after disconnect:', sessions);
    console.log('Current attendance after disconnect:', attendance);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
