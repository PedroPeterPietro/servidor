const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Define o caminho do banco de dados no diretório de dados do usuário
const userDataPath = path.join(process.env.HOME || process.env.USERPROFILE, 'bd-lio-data');
if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath);
}
// OBSERVAÇÃO: Mantenha o nome do arquivo de banco de dados conforme o que você usa (bdlio.sqlite ou oculos.db)
const dbPath = path.join(userDataPath, 'bdlio.sqlite'); 

let db = null;

/**
 * Inicializa a conexão com o banco de dados e cria as tabelas se não existirem.
 */
function initDatabase() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error("Erro ao abrir banco de dados:", err.message);
                return reject(err);
            }
            console.log('Conectado ao banco de dados SQLite.');

            // Criação das tabelas
            db.serialize(() => {
                // Tabela principal de amostras (óculos)
                db.run(`
                    CREATE TABLE IF NOT EXISTS oculos (
                        codigo TEXT PRIMARY KEY,
                        fornecedor TEXT,
                        material_frontal TEXT,
                        cor_frontal TEXT,
                        material_haste TEXT,
                        cor_haste TEXT,
                        tipo_lente TEXT,
                        img_isometrica TEXT,
                        nota_fiscal TEXT
                    )
                `);

                // Tabela de gerenciamento de projetos
                db.run(`
                    CREATE TABLE IF NOT EXISTS projetos (
                        nome TEXT PRIMARY KEY
                    )
                `);

                // Tabela de templates (estrutura de campos) para projetos
                db.run(`
                    CREATE TABLE IF NOT EXISTS projeto_templates (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        nome_projeto TEXT NOT NULL,
                        nome_campo TEXT NOT NULL,
                        tipo_campo TEXT NOT NULL DEFAULT 'text',
                        UNIQUE(nome_projeto, nome_campo)
                    )
                `);
                
                // Tabela de valores (dados reais) dos parâmetros por amostra e projeto
                db.run(`
                    CREATE TABLE IF NOT EXISTS parametro_valores (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        amostra_codigo TEXT NOT NULL,
                        nome_projeto TEXT NOT NULL,
                        nome_campo TEXT NOT NULL,
                        valor_campo TEXT,
                        FOREIGN KEY (amostra_codigo) REFERENCES oculos (codigo) ON DELETE CASCADE,
                        UNIQUE(amostra_codigo, nome_projeto, nome_campo)
                    )
                `);

                // Tabela para rastrear quais amostras estão vinculadas a quais projetos
                db.run(`
                    CREATE TABLE IF NOT EXISTS amostra_projetos (
                        amostra_codigo TEXT NOT NULL,
                        nome_projeto TEXT NOT NULL,
                        PRIMARY KEY (amostra_codigo, nome_projeto),
                        FOREIGN KEY (amostra_codigo) REFERENCES oculos (codigo) ON DELETE CASCADE,
                        FOREIGN KEY (nome_projeto) REFERENCES projetos (nome) ON DELETE CASCADE
                    )
                `);
                
                // ----------------------------------------------------------------------
                // ATUALIZAÇÃO DO BANCO DE DADOS (CORREÇÃO DE COLUNA AUSENTE)
                // ----------------------------------------------------------------------
                // Adiciona a coluna 'tipo_campo' se ela ainda não existir na tabela 'projeto_templates'
                
                db.run("ALTER TABLE projeto_templates ADD COLUMN tipo_campo TEXT DEFAULT 'text'", (err) => {
                    if (err && !err.message.includes('duplicate column name')) {
                        console.error("Erro ao tentar adicionar tipo_campo:", err);
                    } else if (!err) {
                        console.log("Coluna 'tipo_campo' adicionada (ou já existia).");
                    }
                });
                
                // ----------------------------------------------------------------------

                resolve();
            });
        });
    });
}

// ---------------------------------------------
// Funções CRUD Amostras (oculos)
// ---------------------------------------------

function addSample(data) {
    return new Promise((resolve, reject) => {
        db.run(`
            INSERT INTO oculos (codigo, fornecedor, material_frontal, cor_frontal, material_haste, cor_haste, tipo_lente, img_isometrica, nota_fiscal)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            data.codigo, data.fornecedor, data.material_frontal, data.cor_frontal, 
            data.material_haste, data.cor_haste, data.tipo_lente, 
            data.img_isometrica || null, data.nota_fiscal || null
        ], function(err) {
            if (err) reject(err);
            else resolve({ success: true, id: this.lastID });
        });
    });
}

function updateSample(codigo, data) {
    return new Promise((resolve, reject) => {
        const fields = [];
        const values = [];

        for (const key in data) {
            if (key !== 'codigo') {
                fields.push(`${key} = ?`);
                values.push(data[key]);
            }
        }
        
        if (fields.length === 0) return resolve({ success: true, changes: 0 });

        values.push(codigo);

        db.run(`
            UPDATE oculos SET ${fields.join(', ')} WHERE codigo = ?
        `, values, function(err) {
            if (err) reject(err);
            else resolve({ success: true, changes: this.changes });
        });
    });
}

function deleteSample(codigo) {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM oculos WHERE codigo = ?`, [codigo], function(err) {
            if (err) reject(err);
            else resolve({ success: true, changes: this.changes });
        });
    });
}

function getSamples() {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM oculos ORDER BY codigo", (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function getSampleByCode(codigo) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM oculos WHERE codigo = ?", [codigo], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}


// ---------------------------------------------
// Funções CRUD Projetos
// ---------------------------------------------

function addProject(nome) {
    return new Promise((resolve, reject) => {
        db.run(`
            INSERT INTO projetos (nome) VALUES (?)
        `, [nome], function(err) {
            if (err) reject(err);
            else resolve({ success: true, id: this.lastID });
        });
    });
}

function getAllProjects() {
    return new Promise((resolve, reject) => {
        db.all("SELECT nome FROM projetos ORDER BY nome", (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(row => row.nome));
        });
    });
}


// ---------------------------------------------
// Funções CRUD Templates
// ---------------------------------------------

/**
 * Função UNIFICADA: Cria/garante que o projeto existe e, em seguida, salva/atualiza seu template.
 */
function createOrUpdateProjectAndTemplate(nomeProjeto, campos) {
    return new Promise(async (resolve, reject) => {
        db.serialize(async () => {
            db.run("BEGIN TRANSACTION");

            try {
                // 1. Cria o Projeto (ou ignora se já existe)
                await new Promise((res, rej) => {
                    db.run(`INSERT OR IGNORE INTO projetos (nome) VALUES (?)`, [nomeProjeto], (err) => {
                        if (err) rej(err);
                        else res();
                    });
                });
                
                // 2. Remove templates antigos
                await new Promise((res, rej) => {
                    db.run("DELETE FROM projeto_templates WHERE nome_projeto = ?", [nomeProjeto], (err) => {
                        if (err) rej(err);
                        else res();
                    });
                });

                // 3. Insere os novos campos
                if (campos.length > 0) {
                    const placeholders = campos.map(() => '(?, ?, ?)').join(', ');
                    const values = campos.flatMap(c => [nomeProjeto, c.nome_campo, c.tipo_campo || 'text']); 
                    
                    await new Promise((res, rej) => {
                        db.run(`
                            INSERT INTO projeto_templates (nome_projeto, nome_campo, tipo_campo) 
                            VALUES ${placeholders}
                        `, values, (err) => {
                            if (err) rej(err);
                            else res();
                        });
                    });
                }

                db.run("COMMIT", (err) => {
                    if (err) reject(err);
                    else resolve({ success: true, changes: campos.length });
                });
                
            } catch (err) {
                db.run("ROLLBACK");
                reject(err);
            }
        });
    });
}


function saveProjectTemplate(nomeProjeto, campos) {
    // Redireciona para a função unificada
    return createOrUpdateProjectAndTemplate(nomeProjeto, campos); 
}

function getProjectTemplate(nomeProjeto) {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT nome_campo, tipo_campo FROM projeto_templates WHERE nome_projeto = ? ORDER BY id
        `, [nomeProjeto], (err, rows) => {
            if (err) reject(err);
            else resolve(rows); 
        });
    });
}


// ---------------------------------------------
// Funções CRUD Valores (Parâmetros)
// ---------------------------------------------

function saveParametroValores(amostraCodigo, nomeProjeto, valores) {
    return new Promise(async (resolve, reject) => {
        db.serialize(async () => {
            db.run("BEGIN TRANSACTION");

            try {
                for (const item of valores) {
                    const { nome_campo, valor_campo } = item;
                    
                    // Tenta atualizar. Se não existir, insere.
                    await new Promise((res, rej) => {
                        db.run(`
                            INSERT INTO parametro_valores (amostra_codigo, nome_projeto, nome_campo, valor_campo)
                            VALUES (?, ?, ?, ?)
                            ON CONFLICT(amostra_codigo, nome_projeto, nome_campo) 
                            DO UPDATE SET valor_campo = excluded.valor_campo;
                        `, [amostraCodigo, nomeProjeto, nome_campo, valor_campo], (err) => {
                            if (err) rej(err);
                            else res();
                        });
                    });
                }
                
                db.run("COMMIT", (err) => {
                    if (err) reject(err);
                    else resolve({ success: true });
                });
                
            } catch (err) {
                db.run("ROLLBACK");
                reject(err);
            }
        });
    });
}

function getParametroValores(amostraCodigo, nomeProjeto) {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT nome_campo, valor_campo FROM parametro_valores 
            WHERE amostra_codigo = ? AND nome_projeto = ?
        `, [amostraCodigo, nomeProjeto], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}


// ---------------------------------------------
// Funções de Vínculo (amostra_projetos)
// ---------------------------------------------

function addProjectToSample(amostraCodigo, nomeProjeto) {
    return new Promise((resolve, reject) => {
        db.run(`
            INSERT OR IGNORE INTO amostra_projetos (amostra_codigo, nome_projeto)
            VALUES (?, ?)
        `, [amostraCodigo, nomeProjeto], function(err) {
            if (err) reject(err);
            else resolve({ success: true });
        });
    });
}

function getAllDataForExport() {
    return new Promise((resolve, reject) => {
        // SQL complexo para juntar todas as amostras, seus projetos e valores de parâmetros
        db.all(`
            SELECT 
                o.codigo, o.fornecedor, o.material_frontal, o.cor_frontal, 
                o.material_haste, o.cor_haste, o.tipo_lente, 
                o.img_isometrica, o.nota_fiscal,
                ap.nome_projeto,
                pv.nome_campo,
                pv.valor_campo
            FROM oculos o
            LEFT JOIN amostra_projetos ap ON o.codigo = ap.amostra_codigo
            LEFT JOIN parametro_valores pv ON o.codigo = pv.amostra_codigo AND ap.nome_projeto = pv.nome_projeto
            ORDER BY o.codigo, ap.nome_projeto, pv.nome_campo
        `, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

module.exports = {
    initDatabase,
    addSample,
    updateSample,
    deleteSample,
    getSamples,
    getSampleByCode,
    addProject,
    getAllProjects,
    saveProjectTemplate,
    getProjectTemplate,
    saveParametroValores,
    getParametroValores,
    addProjectToSample,
    getAllDataForExport,
    // NOVO: Função unificada para cadastro/atualização de projeto e template
    createOrUpdateProjectAndTemplate 
};
