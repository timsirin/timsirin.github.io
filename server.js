// 1. IMPORTS
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

// IMPORTEZ VOTRE CONNEXION POSTGRESQL (database.js)
const db = require('./database'); 

const app = express();
const PORT = process.env.PORT || 10000;

// 2. MIDDLEWARES
app.use(express.json());
app.use(cors());

// =============================================
// 3. ROUTE D'INSCRIPTION (Register)
// =============================================
app.post('/register', async (req, res) => {
    try {
        const { email, password, name, role } = req.body;

        // Vérifier si l'utilisateur existe déjà dans PostgreSQL
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
// 4. ROUTE DE CONNEXION (Login) - CORRIGÉE
// =============================================
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // ÉTAPE 1 : Récupérer l'utilisateur dans la base PostgreSQL
        const user = await db.get('SELECT * FROM users WHERE email = $1', [email]);

        // ==========================================================
        // CORRECTION DE SÉCURITÉ AJOUTÉE (Empêche l'erreur "Illegal arguments")
        // On vérifie bien 'password_hash' car c'est le nom de la colonne SQL
        // ==========================================================
        if (!user || !user.password_hash) {
            return res.status(401).json({ error: "Email ou mot de passe incorrect" });
        }
        // ==========================================================

        // ÉTAPE 2 : Comparer le mot de passe envoyé avec le hash stocké
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(401).json({ error: "Email ou mot de passe incorrect" });
        }

        // ÉTAPE 3 : Générer le token JWT
        // "process.env.JWT_SECRET" lira la valeur "azul_tamazight" que vous mettrez sur Render
        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role }, 
            process.env.JWT_SECRET, 
            { expiresIn: '7d' }
        );

        // ÉTAPE 4 : Réponse au Frontend
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
// 5. ROUTE DE RÉCUPÉRATION DES STATS FINANCIERS (Dashboard Admin)
// =============================================
app.get('/stats/financial', async (req, res) => {
    try {
        // Calcule le total des montants versés par les étudiants
        const totalPaid = await db.get('SELECT SUM(amount_paid) as total FROM students');
        
        // Réponse JSON
        res.json({
            total_encaisse: parseFloat(totalPaid?.total || 0),
            total_dons: 0.00 // Placeholder si vous n'avez pas de table dédiée aux dons
        });
    } catch (error) {
        console.error('❌ Erreur Stats:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// 6. ROUTE POUR RÉCUPÉRER LES COURS
// =============================================
app.get('/courses', async (req, res) => {
    try {
        const rows = await db.all('SELECT * FROM courses');
        res.json(rows);
    } catch (error) {
        console.error('❌ Erreur Courses:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// 7. ROUTE POUR RÉCUPÉRER LES ÉTUDIANTS
// =============================================
app.get('/students', async (req, res) => {
    try {
        const rows = await db.all('SELECT * FROM students');
        res.json(rows);
    } catch (error) {
        console.error('❌ Erreur Students:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// 8. LANCEMENT DU SERVEUR
// =============================================
app.listen(PORT, () => {
    console.log(`🚀 Serveur Timsirin démarré sur le port ${PORT}`);
});