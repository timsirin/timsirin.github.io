// 1. IMPORTS
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// IMPORTEZ VOTRE CONNEXION POSTGRESQL (database.js)
const db = require('./database'); 

const app = express();
const PORT = process.env.PORT || 10000;

// 2. MIDDLEWARES
app.use(express.json());
app.use(cors());

// Servir les fichiers statiques (ex: index.html)
app.use(express.static(path.join(__dirname)));

// =============================================
// 3. ROUTE D'INSCRIPTION (Register)
// =============================================
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, name, role } = req.body;

        // Vérifier si l'utilisateur existe déjà
        const existingUser = await db.get('SELECT * FROM users WHERE email = $1', [email]);
        if (existingUser) {
            return res.status(400).json({ message: "Cet email est déjà utilisé" });
        }

        // Hasher le mot de passe
        const hashedPassword = await bcrypt.hash(password, 10);

        // Créer l'utilisateur dans la table 'users'
        await db.run(
            'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
            [email, hashedPassword, name || 'Utilisateur', role || 'teacher']
        );

        res.status(201).json({ message: "Utilisateur créé avec succès" });
    } catch (error) {
        console.error('❌ Erreur Register:', error);
        res.status(500).json({ message: error.message });
    }
});

// =============================================
// 4. ROUTE DE CONNEXION (Login)
// =============================================
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Récupérer l'utilisateur
        const user = await db.get('SELECT * FROM users WHERE email = $1', [email]);

        if (!user || !user.password_hash) {
            return res.status(401).json({ error: "Email ou mot de passe incorrect" });
        }

        // Comparer le mot de passe
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(401).json({ error: "Email ou mot de passe incorrect" });
        }

        // Générer le token JWT
        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role }, 
            process.env.JWT_SECRET || 'defaul_secret_key', 
            { expiresIn: '7d' }
        );

        // Réponse au Frontend
        res.json({ 
            token, 
            user: { 
                id: user.id, 
                email: user.email, 
                name: user.name, 
                role: user.role 
            } 
        });

    } catch (error) {
        console.error('❌ Erreur lors du login:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// 5. ROUTE DES STATS FINANCIERS
// =============================================
app.get('/api/stats/financial', async (req, res) => {
    try {
        const totalPaid = await db.get('SELECT SUM(amount_paid) as total FROM students');
        res.json({
            total_encaisse: parseFloat(totalPaid?.total || 0),
            total_dons: 0.00
        });
    } catch (error) {
        console.error('❌ Erreur Stats:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// 6. ROUTES COURS & ÉTUDIANTS
// =============================================
app.get('/api/courses', async (req, res) => {
    try {
        const rows = await db.all('SELECT * FROM courses');
        res.json(rows);
    } catch (error) {
        console.error('❌ Erreur Courses:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/students', async (req, res) => {
    try {
        const rows = await db.all('SELECT * FROM students');
        res.json(rows);
    } catch (error) {
        console.error('❌ Erreur Students:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/attendance', async (req, res) => {
    try {
        const rows = await db.all('SELECT * FROM attendance');
        res.json(rows);
    } catch (error) {
        console.error('❌ Erreur Attendance:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/planning', async (req, res) => {
    try {
        const courses = await db.all('SELECT * FROM courses');
        const slots = await db.all('SELECT * FROM slots');
        const learners = await db.all('SELECT * FROM learners');

        const planning = courses.map(c => ({
            ...c,
            slots: slots.filter(s => s.courseid === c.id || s.courseId === c.id),
            learners: learners.filter(l => l.courseid === c.id || l.courseId === c.id).map(l => l.name)
        }));

        res.json(planning);
    } catch (error) {
        console.error('❌ Erreur Planning:', error);
        res.status(500).json({ error: error.message });
    }
});

// Route par défaut (SPA / HTML)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// =============================================
// 7. LANCEMENT DU SERVEUR
// =============================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Serveur Timsirin démarré sur le port ${PORT}`);
});