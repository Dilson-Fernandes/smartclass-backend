const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { registerTeacher, registerStudent, authenticateTeacher, authenticateStudent, isUsnUnique } = require('./database'); // Import database functions

const app = express();
app.use(cors());
app.use(express.json()); // Enable JSON body parsing for Express
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

// Signup routes
app.post('/signup-teacher', (req, res) => {
  const { username, password } = req.body;
  registerTeacher(username, password, (err, user) => {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.status(409).json({ message: 'Teacher username already exists.' });
      }
      console.error('Teacher signup error:', err);
      return res.status(500).json({ message: 'Error registering teacher.' });
    }
    res.status(201).json({ message: 'Teacher registered successfully.', user });
  });
});

app.post('/signup-student', (req, res) => {
  const { username, usn, password } = req.body;
  isUsnUnique(usn, (err, isUnique) => {
    if (err) {
      console.error('USN uniqueness check error:', err);
      return res.status(500).json({ message: 'Error checking USN uniqueness.' });
    }
    if (!isUnique) {
      return res.status(409).json({ message: 'USN already registered.' });
    }
    registerStudent(username, usn, password, (err, user) => {
      if (err) {
        console.error('Student signup error:', err);
        return res.status(500).json({ message: 'Error registering student.' });
      }
      res.status(201).json({ message: 'Student registered successfully.', user });
    });
  });
});

// Login routes
app.post('/login-teacher', (req, res) => {
  const { username, password } = req.body;
  authenticateTeacher(username, password, (err, user) => {
    if (err) {
      console.error('Teacher login error:', err);
      return res.status(500).json({ message: 'Error during teacher login.' });
    }
    if (!user) {
      return res.status(401).json({ message: 'Invalid teacher credentials.' });
    }
    res.status(200).json({ message: 'Teacher logged in successfully.', user: { id: user.id, username: user.username } });
  });
});

app.post('/login-student', (req, res) => {
  const { usn, password } = req.body;
  authenticateStudent(usn, password, (err, user) => {
    if (err) {
      console.error('Student login error:', err);
      return res.status(500).json({ message: 'Error during student login.' });
    }
    if (!user) {
      return res.status(401).json({ message: 'Invalid student credentials.' });
    }
    res.status(200).json({ message: 'Student logged in successfully.', user: { id: user.id, username: user.username, usn: user.usn } });
  });
});

// Download attendance endpoint
app.get('/download-attendance/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const sessionAttendance = attendance[sessionId];

  if (!sessionAttendance || sessionAttendance.length === 0) {
    return res.status(404).json({ message: 'No attendance data found for this session.' });
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=attendance_session_${sessionId}.json`);
  res.send(JSON.stringify(sessionAttendance, null, 2));
});


io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Handle a user joining a session
  socket.on('join-session', ({ sessionId, isTeacher, username, usn, password }) => {
    console.log(`Received join-session: sessionId=${sessionId}, isTeacher=${isTeacher}, username=${username}, usn=${usn}`);

    // Authenticate user before allowing to join session
    const authenticateUser = isTeacher ? authenticateTeacher : authenticateStudent;
    const authIdentifier = isTeacher ? username : usn; // Use username for teacher, USN for student

    authenticateUser(authIdentifier, password, (err, user) => {
      if (err || !user) {
        console.log(`Authentication failed for ${authIdentifier}:`, err);
        socket.emit('auth-failed', { message: 'Authentication failed. Invalid credentials or user not found.' });
        return;
      }

      socket.join(sessionId);
      if (!sessions[sessionId]) {
        sessions[sessionId] = { teacher: null, students: [], participants: {} };
        attendance[sessionId] = []; // Ensure attendance is initialized for new sessions
      }

      // Check for unique USN enforcement for students
      if (!isTeacher) {
        // This check ensures a student with a given USN can only join once per session
        const usnAlreadyInSession = Object.values(sessions[sessionId].participants)
          .some(p => p.usn === user.usn && p.isTeacher === false);
        if (usnAlreadyInSession) {
          socket.emit('join-failed', { message: `Student with USN ${user.usn} is already in the session.` });
          socket.leave(sessionId);
          return;
        }
      }

      // Add participant details to the session (using authenticated user's data)
      sessions[sessionId].participants[socket.id] = { username: user.username, usn: user.usn || 'N/A', isTeacher };

      if (isTeacher) {
        sessions[sessionId].teacher = socket.id;
        console.log(`Teacher ${user.username} (${socket.id}) joined session ${sessionId}`);
        socket.emit('session-created', sessionId); // Emit the session ID to the teacher

        // Notify all current students in the session about the teacher
        Object.keys(sessions[sessionId].participants).forEach(participantId => {
          if (participantId !== socket.id && !sessions[sessionId].participants[participantId].isTeacher) {
            io.to(participantId).emit('teacher-joined', { teacherSocketId: socket.id, teacherName: user.username });
          }
        });

      } else { // It's a student
        sessions[sessionId].students.push(socket.id);
        console.log(`Student ${user.username} (${user.usn}, ${socket.id}) joined session ${sessionId}`);
        const joinTime = new Date().toISOString();
        attendance[sessionId].push({ studentId: socket.id, username: user.username, usn: user.usn, joinTime });
        console.log(`Attendance recorded for student ${user.username} in session ${sessionId} at ${joinTime}`);

        // Notify the teacher (if present) about a new student joining
        if (sessions[sessionId].teacher) {
          io.to(sessions[sessionId].teacher).emit('student-joined', { studentSocketId: socket.id, studentName: user.username, studentUsn: user.usn });
        }
        // Notify the joining student about existing participants (including other students)
        Object.entries(sessions[sessionId].participants).forEach(([participantId, participant]) => {
          if (participantId !== socket.id) {
            io.to(socket.id).emit(participant.isTeacher ? 'teacher-joined' : 'student-joined', {
              [`${participant.isTeacher ? 'teacher' : 'student'}SocketId`]: participantId,
              [`${participant.isTeacher ? 'teacher' : 'student'}Name`]: participant.username,
              ...(participant.usn && { [`${'student'}Usn`]: participant.usn })
            });
          }
        });
      }
      // Emit join-success to the client that just joined
      socket.emit('join-success', { sessionId: sessionId, user: { username: user.username, usn: user.usn, isTeacher: isTeacher } });
      console.log('Current sessions:', sessions);
      console.log('Current attendance:', attendance);
    });
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

  // Handle public and private messages
  socket.on('send-message', ({ sessionId, message, senderId, isPrivate, targetId, senderName }) => {
    if (isPrivate && targetId) {
      io.to(targetId).emit('new-message', { senderId, message, isPrivate: true, targetId, senderName });
      io.to(senderId).emit('new-message', { senderId, message, isPrivate: true, targetId, senderName }); // Send back to sender for their own display
    } else {
      io.to(sessionId).emit('new-message', { senderId, message, isPrivate: false, senderName });
    }
  });


  // Handle real-time messaging (Q&A)
  socket.on('send-question', ({ sessionId, question, studentId }) => {
    // Forward the question to the teacher in the session
    if (sessions[sessionId] && sessions[sessionId].teacher) {
      io.to(sessions[sessionId].teacher).emit('new-question', { question, studentId, studentName: sessions[sessionId].participants[studentId]?.username || 'Anonymous' });
      console.log(`Question from ${studentId} in session ${sessionId}: ${question}`);
    }
  });


  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    for (const sessionId in sessions) {
      if (!sessions[sessionId]) continue; // Ensure session exists

      if (sessions[sessionId].teacher === socket.id) {
        console.log(`Teacher ${socket.id} left session ${sessionId}. Ending session.`);
        io.to(sessionId).emit('session-ended', sessionId);
        delete sessions[sessionId];
        delete attendance[sessionId];
        break;
      }

      const studentIndex = sessions[sessionId].students.indexOf(socket.id);
      if (studentIndex > -1) {
        sessions[sessionId].students.splice(studentIndex, 1);
        delete sessions[sessionId].participants[socket.id]; // Remove from participants
        io.to(sessionId).emit('participant-left', socket.id); // Notify all in session
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
