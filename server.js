const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mysql = require('@tidbcloud/serverless');

const client = connect({
  url: process.env.TIDB_URL // full secure connection string
});
const app = express();
const PORT = 3000; // Ensure this matches the port in your Frontend Settings

// Middleware
app.use(cors());
app.use(bodyParser.json());



// Helper to format DB rows to Frontend CamelCase
const toCamel = (row) => {
    const newRow = {};
    for (const key in row) {
        const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
        newRow[camelKey] = row[key];
    }
    return newRow;
};

// --- ROUTES ---

// 1. Auth
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);
        if (rows.length > 0) {
            const user = rows[0];
            res.json({ username: user.username, role: user.role });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Hostels
app.get('/api/hostels', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM hostels');
        res.json(rows);
    } catch (err) { res.status(500).json(err); }
});

app.post('/api/hostels', async (req, res) => {
    const { name, address } = req.body;
    try {
        const [result] = await pool.query('INSERT INTO hostels (name, address) VALUES (?, ?)', [name, address]);
        res.json({ id: result.insertId, name, address });
    } catch (err) { res.status(500).json(err); }
});

app.put('/api/hostels/:id', async (req, res) => {
    const { name, address } = req.body;
    try {
        await pool.query('UPDATE hostels SET name = ?, address = ? WHERE id = ?', [name, address, req.params.id]);
        res.json({ id: req.params.id, name, address });
    } catch (err) { res.status(500).json(err); }
});

// 3. Tenants
app.get('/api/tenants', async (req, res) => {
    const { hostelId } = req.query;
    try {
        const [rows] = await pool.query(`
            SELECT id, hostel_id, name, room_number, phone_number, email, aadhar_number, 
            address, rent_amount, is_paid, collected_by, DATE_FORMAT(join_date, '%Y-%m-%d') as join_date 
            FROM tenants WHERE hostel_id = ?`, [hostelId]);
        res.json(rows.map(toCamel));
    } catch (err) { res.status(500).json(err); }
});

app.post('/api/tenants', async (req, res) => {
    const t = req.body;
    try {
        const [result] = await pool.query(`
            INSERT INTO tenants (hostel_id, name, room_number, phone_number, email, aadhar_number, address, rent_amount, is_paid, join_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
            [t.hostelId, t.name, t.roomNumber, t.phoneNumber, t.email, t.aadharNumber, t.address, t.rentAmount, false, t.joinDate]
        );
        res.json({ id: result.insertId, ...t });
    } catch (err) { res.status(500).json(err); }
});

app.put('/api/tenants/:id', async (req, res) => {
    const t = req.body;
    try {
        // Handle dynamic updates based on what's passed
        if (t.isPaid !== undefined) {
             await pool.query('UPDATE tenants SET is_paid = ?, collected_by = ? WHERE id = ?', [t.isPaid, t.collectedBy, req.params.id]);
        } else {
             await pool.query(`
                UPDATE tenants SET name=?, room_number=?, phone_number=?, email=?, aadhar_number=?, address=?, rent_amount=? 
                WHERE id=?`, 
                [t.name, t.roomNumber, t.phoneNumber, t.email, t.aadharNumber, t.address, t.rentAmount, req.params.id]);
        }
        res.json({ id: req.params.id, ...t });
    } catch (err) { res.status(500).json(err); }
});

app.delete('/api/tenants/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM tenants WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json(err); }
});

// 4. Vacancies
app.get('/api/vacancies', async (req, res) => {
    const { hostelId } = req.query;
    try {
        const [rows] = await pool.query(`
            SELECT id, hostel_id, room_number, sharing_type, DATE_FORMAT(available_from, '%Y-%m-%d') as available_from, 
            comments, status, booked_by, booked_phone, DATE_FORMAT(check_in_date, '%Y-%m-%d') as check_in_date 
            FROM vacancies WHERE hostel_id = ?`, [hostelId]);
        res.json(rows.map(toCamel));
    } catch (err) { res.status(500).json(err); }
});

app.post('/api/vacancies', async (req, res) => {
    const v = req.body;
    try {
        const [result] = await pool.query(`
            INSERT INTO vacancies (hostel_id, room_number, sharing_type, available_from, comments, status)
            VALUES (?, ?, ?, ?, ?, 'AVAILABLE')`, 
            [v.hostelId, v.roomNumber, v.sharingType, v.availableFrom, v.comments]
        );
        res.json({ id: result.insertId, ...v });
    } catch (err) { res.status(500).json(err); }
});

app.put('/api/vacancies/:id', async (req, res) => {
    const v = req.body;
    try {
        if (v.status === 'BOOKED') {
            await pool.query(`
                UPDATE vacancies SET status='BOOKED', booked_by=?, booked_phone=?, check_in_date=? 
                WHERE id=?`, [v.bookedBy, v.bookedPhone, v.checkInDate, req.params.id]);
        } else if (v.status === 'AVAILABLE') {
            await pool.query(`
                UPDATE vacancies SET status='AVAILABLE', booked_by=NULL, booked_phone=NULL, check_in_date=NULL 
                WHERE id=?`, [req.params.id]);
        }
        res.json({ id: req.params.id, ...v });
    } catch (err) { res.status(500).json(err); }
});

app.delete('/api/vacancies/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM vacancies WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json(err); }
});

// 5. Expenses
app.get('/api/expenses', async (req, res) => {
    const { hostelId } = req.query;
    try {
        const [rows] = await pool.query(`
            SELECT id, hostel_id, title, amount, category, DATE_FORMAT(date, '%Y-%m-%d') as date 
            FROM expenses WHERE hostel_id = ?`, [hostelId]);
        res.json(rows.map(toCamel));
    } catch (err) { res.status(500).json(err); }
});

app.post('/api/expenses', async (req, res) => {
    const e = req.body;
    try {
        const [result] = await pool.query(`
            INSERT INTO expenses (hostel_id, title, amount, date, category)
            VALUES (?, ?, ?, ?, ?)`, 
            [e.hostelId, e.title, e.amount, e.date, e.category]
        );
        res.json({ id: result.insertId, ...e });
    } catch (err) { res.status(500).json(err); }
});

app.listen(PORT, () => {
    console.log(`Yuvan Hostel API running on port ${PORT}`);

});

