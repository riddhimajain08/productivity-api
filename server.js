const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// --- MIDDLEWARE (The Security Guard) ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 

    if (!token) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// --- AUTH ROUTES ---

// 1. REGISTER
app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await db.query(
            'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING *',
            [name, email, hashedPassword]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// 2. LOGIN
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(400).json({ error: 'User not found' });

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(401).json({ error: 'Invalid password' });

        const token = jwt.sign({ user_id: user.user_id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// --- TASK ROUTES ---

// 3. CREATE TASK
app.post('/tasks', authenticateToken, async (req, res) => {
    const { title, description, priority, deadline } = req.body;
    try {
        const result = await db.query(
            `INSERT INTO tasks (user_id, title, description, priority, deadline) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [req.user.user_id, title, description, priority, deadline]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// 4. GET TASKS (With Search & Filter)
app.get('/tasks', authenticateToken, async (req, res) => {
    const { status, priority, search } = req.query;
    
    // Start with a base query that only selects THIS user's tasks
    let queryText = 'SELECT * FROM tasks WHERE user_id = $1';
    let queryParams = [req.user.user_id];
    let paramCount = 1;

    // Add filters dynamically if they exist
    if (status) {
        paramCount++;
        queryText += ` AND status = $${paramCount}`;
        queryParams.push(status);
    }
    if (priority) {
        paramCount++;
        queryText += ` AND priority = $${paramCount}`;
        queryParams.push(priority);
    }
    if (search) {
        paramCount++;
        queryText += ` AND (title ILIKE $${paramCount} OR description ILIKE $${paramCount})`;
        queryParams.push(`%${search}%`); // ILIKE is case-insensitive search
    }

    try {
        const result = await db.query(queryText, queryParams);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// 5. UPDATE TASK
app.put('/tasks/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { title, description, priority, status, deadline } = req.body;

    try {
        const result = await db.query(
            `UPDATE tasks 
             SET title = COALESCE($1, title), 
                 description = COALESCE($2, description), 
                 priority = COALESCE($3, priority), 
                 status = COALESCE($4, status), 
                 deadline = COALESCE($5, deadline),
                 updated_at = CURRENT_TIMESTAMP
             WHERE task_id = $6 AND user_id = $7 
             RETURNING *`,
            [title, description, priority, status, deadline, id, req.user.user_id]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// 6. DELETE TASK
app.delete('/tasks/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query(
            'DELETE FROM tasks WHERE task_id = $1 AND user_id = $2 RETURNING *',
            [id, req.user.user_id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
        res.json({ message: 'Task deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// --- ANALYTICS ROUTE ---

// 7. DASHBOARD STATS
app.get('/dashboard/stats', authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    try {
        // Run multiple queries in parallel for speed
        const totalPromise = db.query('SELECT COUNT(*) FROM tasks WHERE user_id = $1', [userId]);
        const completedPromise = db.query('SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND status = $2', [userId, 'Completed']);
        const pendingPromise = db.query('SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND status = $2', [userId, 'Pending']);
        const highPriorityPromise = db.query('SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND priority = $2', [userId, 'High']);
        
        // Count tasks where deadline has passed AND status is NOT completed
        const overduePromise = db.query(
            `SELECT COUNT(*) FROM tasks 
             WHERE user_id = $1 AND status != 'Completed' AND deadline < NOW()`, 
             [userId]
        );

        const [total, completed, pending, highPriority, overdue] = await Promise.all([
            totalPromise, completedPromise, pendingPromise, highPriorityPromise, overduePromise
        ]);

        res.json({
            totalTasks: parseInt(total.rows[0].count),
            completedTasks: parseInt(completed.rows[0].count),
            pendingTasks: parseInt(pending.rows[0].count),
            highPriorityTasks: parseInt(highPriority.rows[0].count),
            overdueTasks: parseInt(overdue.rows[0].count)
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// TEMPORARY: Route to create tables in the cloud database
app.get('/init-db', async (req, res) => {
  try {
    const createUsersTable = `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password TEXT NOT NULL
      );
    `;
    
    const createTasksTable = `
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title VARCHAR(100) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'Pending',
        user_id INTEGER REFERENCES users(id)
      );
    `;

    await db.query(createUsersTable);
    await db.query(createTasksTable);

    res.send("Tables created successfully! You can now register and login.");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error creating tables: " + error.message);
  }
});
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});