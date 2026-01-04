const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const DB_PATH = './classroom.db';
const saltRounds = 10;

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error connecting to database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    db.run(`CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      usn TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )`);
  }
});

// Function to register a new teacher
const registerTeacher = (username, password, callback) => {
  bcrypt.hash(password, saltRounds, (err, hash) => {
    if (err) {
      return callback(err);
    }
    db.run('INSERT INTO teachers (username, password) VALUES (?, ?)', [username, hash], function(err) {
      if (err) {
        return callback(err);
      }
      callback(null, { id: this.lastID, username });
    });
  });
};

// Function to register a new student
const registerStudent = (username, usn, password, callback) => {
  bcrypt.hash(password, saltRounds, (err, hash) => {
    if (err) {
      return callback(err);
    }
    db.run('INSERT INTO students (username, usn, password) VALUES (?, ?, ?)', [username, usn, hash], function(err) {
      if (err) {
        return callback(err);
      }
      callback(null, { id: this.lastID, username, usn });
    });
  });
};

// Function to authenticate a teacher
const authenticateTeacher = (username, password, callback) => {
  db.get('SELECT * FROM teachers WHERE username = ?', [username], (err, user) => {
    if (err) {
      return callback(err);
    }
    if (!user) {
      return callback(null, false); // User not found
    }
    bcrypt.compare(password, user.password, (err, result) => {
      if (err) {
        return callback(err);
      }
      callback(null, result ? user : false); // Return user if password matches, else false
    });
  });
};

// Function to authenticate a student
const authenticateStudent = (usn, password, callback) => {
  db.get('SELECT * FROM students WHERE usn = ?', [usn], (err, user) => {
    if (err) {
      return callback(err);
    }
    if (!user) {
      return callback(null, false); // User not found
    }
    bcrypt.compare(password, user.password, (err, result) => {
      if (err) {
        return callback(err);
      }
      callback(null, result ? user : false); // Return user if password matches, else false
    });
  });
};

// Function to check if USN is unique
const isUsnUnique = (usn, callback) => {
  db.get('SELECT usn FROM students WHERE usn = ?', [usn], (err, row) => {
    if (err) {
      return callback(err);
    }
    callback(null, !row); // true if unique, false if not
  });
};

module.exports = {
  db,
  registerTeacher,
  registerStudent,
  authenticateTeacher,
  authenticateStudent,
  isUsnUnique,
};
