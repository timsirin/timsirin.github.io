const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Variables d'environnement
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_FILE_PATH = process.env.GITHUB_FILE_PATH || 'db.sqlite';
const LOCAL_DB_PATH = path.join(__dirname, 'db.sqlite');

// Fonction de sauvegarde
async function backupDatabase() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.log('ℹ️ Variables GitHub non configurées, sauvegarde ignorée.');
    return;
  }
  try {
    // Vérifier que le fichier existe
    if (!fs.existsSync(LOCAL_DB_PATH)) {
      console.log('ℹ️ Aucun fichier db.sqlite à sauvegarder.');
      return;
    }

    const fileContent = fs.readFileSync(LOCAL_DB_PATH, 'base64');
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;

    // Récupérer le SHA si le fichier existe déjà
    let sha = null;
    try {
      const getRes = await axios.get(url, {
        headers: { Authorization: `token ${GITHUB_TOKEN}` }
      });
      sha = getRes.data.sha;
    } catch (e) {
      // Fichier inexistant, on le créera
    }

    const payload = {
      message: `Sauvegarde automatique du ${new Date().toISOString()}`,
      content: fileContent,
      branch: 'main'
    };
    if (sha) payload.sha = sha;

    await axios.put(url, payload, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('✅ Base sauvegardée sur GitHub');
  } catch (err) {
    console.error('❌ Erreur sauvegarde:', err.message);
  }
}

// Fonction de restauration
async function restoreDatabase() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.log('ℹ️ Variables GitHub non configurées, restauration ignorée.');
    return false;
  }
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;
    const response = await axios.get(url, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` }
    });
    const content = Buffer.from(response.data.content, 'base64');
    fs.writeFileSync(LOCAL_DB_PATH, content);
    console.log('✅ Base restaurée depuis GitHub');
    return true;
  } catch (err) {
    console.log('ℹ️ Aucune sauvegarde trouvée sur GitHub, base vierge.');
    return false;
  }
}

module.exports = { backupDatabase, restoreDatabase };