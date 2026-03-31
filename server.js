const express = require('express');
const dbLogic = require('./database.js');
const app = express();
const port = 3000;

// Permite que o servidor entenda JSON enviado pelo Android Studio
app.use(express.json());

// ROTA 1: Receber dados do App (POST)
app.post('/amostra', async (req, res) => {
    try {
        // req.body contém os dados dos óculos enviados pelo celular
        const resultado = await dbLogic.addSample(req.body);
        console.log("Amostra salva:", req.body.codigo);
        res.status(201).json({ mensagem: "Sucesso!", id: resultado.id });
    } catch (err) {
        console.error("Erro ao salvar:", err.message);
        res.status(500).json({ erro: err.message });
    }
});

// ROTA 2: Ver os dados no navegador do seu Pop!_OS (GET)
app.get('/visualizar', async (req, res) => {
    try {
        const dados = await dbLogic.getSamples();
        res.json(dados); // Mostra um JSON bonitão na tela
    } catch (err) {
        res.status(500).send("Erro ao ler banco.");
    }
});

// Inicializa o Banco de Dados e depois sobe o Servidor
dbLogic.initDatabase()
    .then(() => {
        app.listen(port, '0.0.0.0', () => {
            console.log(`Servidor LIO rodando em http://localhost:${port}`);
            console.log(`Acesse pelo IP do Rasp na rede da USP ou de casa.`);
        });
    })
    .catch(err => {
        console.error("Falha ao iniciar banco:", err);
    });
