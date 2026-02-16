/**
 * ============================================================
 * PROJECT: RUNCLOUD ULTIMATE ENTERPRISE SYSTEM (V5.2)
 * VERSION: 5.2.0 (Stability & Feature Patch)
 * DESCRIPTION: Multi-hosting, Social Downloader, Link Analyzer
 * ============================================================
 */

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const admZip = require('adm-zip');
const moment = require('moment');

// ==========================================
// 1. KONFIGURATSIYA VA SETUP
// ==========================================
const TOKEN = '8512274157:AAFWxwWVvaEppB5pxpM1h_U16Eq6Gwh4S3g';
const ADMIN_ID = '709324792';
const PORT = process.env.PORT || 3000;
const BASE_URL = 'https://runcloud.uz'; // O'zingizning asosiy domeningiz

const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();
const SITES_DIR = path.join(__dirname, 'sites');
const TEMP_DIR = path.join(__dirname, 'temp');
const DB_FILE = 'database.json';

// Kataloglarni tayyorlash
fs.ensureDirSync(SITES_DIR);
fs.ensureDirSync(TEMP_DIR);

// ==========================================
// 2. MA'LUMOTLAR BAZASI BOSHQARUVI
// ==========================================
let db = {
    users: {},
    projects: [],
    logs: [],
    system: {
        total_deploys: 0,
        total_downloads: 0,
        start_date: moment().format('YYYY-MM-DD HH:mm:ss')
    }
};

if (fs.existsSync(DB_FILE)) {
    try {
        db = fs.readJsonSync(DB_FILE);
    } catch (e) {
        console.error("DB Error:", e);
    }
}

const saveDB = () => {
    try {
        fs.writeJsonSync(DB_FILE, db, { spaces: 4 });
    } catch (err) {
        console.error("Save DB Error:", err);
    }
};

const userSteps = {};

// ==========================================
// 3. YORDAMCHI FUNKSIYALAR
// ==========================================

// Link tahlilchisi
async function analyzeLink(url) {
    try {
        const response = await axios.get(url, { timeout: 7000 });
        const title = response.data.match(/<title>(.*?)<\/title>/)?.[1] || "Sarlavha topilmadi";
        const metaDesc = response.data.match(/<meta name="description" content="(.*?)"/)?.[1] || "Tavsif topilmadi";
        return { title, metaDesc, domain: new URL(url).hostname };
    } catch (e) {
        return null;
    }
}

// Ijtimoiy tarmoqlardan video yuklovchi (Cobalt API)
async function fetchMedia(url) {
    try {
        const res = await axios.post('https://api.cobalt.tools/api/json', {
            url: url,
            vQuality: '720',
            filenamePattern: 'basic'
        }, {
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
        });
        return res.data;
    } catch (err) {
        return null;
    }
}

// ==========================================
// 4. KLAVIATURALAR (UI)
// ==========================================
const UI = {
    main: (chatId) => ({
        inline_keyboard: [
            [{ text: "🚀 Yangi Deploy", callback_data: "act_deploy" }, { text: "📂 Loyihalarim", callback_data: "act_list" }],
            [{ text: "🎥 Video Downloader", callback_data: "act_down" }, { text: "🔗 Link Analiz", callback_data: "act_link" }],
            [{ text: "👤 Profil", callback_data: "act_profile" }, { text: "📊 Statistika", callback_data: "act_stats" }],
            [{ text: "📞 Yordam", callback_data: "act_help" }]
        ]
    }),
    back: { inline_keyboard: [[{ text: "⬅️ Orqaga", callback_data: "act_home" }]] }
};

// ==========================================
// 5. CALLBACK QUERY HANDLER
// ==========================================
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const msgId = q.message.message_id;
    const data = q.data;

    try {
        if (data === "act_home") {
            return bot.editMessageText("☁️ **RunCloud Enterprise**\nAssalomu alaykum! Kerakli bo'limni tanlang:", {
                chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: UI.main(chatId)
            });
        }

        if (data === "act_deploy") {
            userSteps[chatId] = { step: 'wait_name' };
            return bot.editMessageText("📌 **Loyiha nomini yuboring:**\n(Masalan: `portfolio`, `testbot`)", {
                chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: UI.back
            });
        }

        if (data === "act_down") {
            return bot.editMessageText("🎥 **Video Yuklovchi**\nInstagram, TikTok yoki YouTube havolasini yuboring:", {
                chat_id: chatId, message_id: msgId, reply_markup: UI.back
            });
        }

        if (data === "act_stats") {
            const stats = `📊 **Tizim Statistikasi**\n\n🚀 Deploylar: ${db.system.total_deploys}\n🎥 Yuklamalar: ${db.system.total_downloads}\n👥 Foydalanuvchilar: ${Object.keys(db.users).length}\n📅 Ishga tushgan: ${db.system.start_date}`;
            return bot.editMessageText(stats, { chat_id: chatId, message_id: msgId, reply_markup: UI.back });
        }

        if (data === "act_list") {
            const userProjects = db.projects.filter(p => p.owner === chatId);
            if (userProjects.length === 0) return bot.answerCallbackQuery(q.id, { text: "Loyihalar topilmadi!", show_alert: true });
            
            let txt = "📂 **Sizning loyihalaringiz:**\n\n";
            const btns = userProjects.map(p => ([{ text: `🔗 ${p.name}`, url: p.url }]));
            btns.push([{ text: "⬅️ Orqaga", callback_data: "act_home" }]);
            return bot.editMessageText(txt, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
        }

        bot.answerCallbackQuery(q.id);
    } catch (e) { console.error(e); }
});

// ==========================================
// 6. MATN VA HAVOLALARNI QAYTA ISHLASH
// ==========================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    // A. Ijtimoiy tarmoqlar va Link tahlili
    if (text.startsWith('http')) {
        const isSocial = /instagram|tiktok|youtube|pinterest|twitter/.test(text.toLowerCase());
        
        if (isSocial) {
            const wait = await bot.sendMessage(chatId, "⏳ **Video tahlil qilinmoqda...**");
            const media = await fetchMedia(text);
            if (media && media.url) {
                db.system.total_downloads++; saveDB();
                await bot.deleteMessage(chatId, wait.message_id);
                return bot.sendVideo(chatId, media.url, { caption: "✅ Yuklab olindi!" });
            } else {
                return bot.editMessageText("❌ Videoni yuklab bo'lmadi. Link noto'g'ri yoki video yopiq profilga tegishli.", {
                    chat_id: chatId, message_id: wait.message_id
                });
            }
        } else {
            const info = await analyzeLink(text);
            if (info) {
                let report = `🔗 **Havola Tahlili:**\n\n🌐 **Host:** ${info.domain}\n📄 **Sarlavha:** ${info.title}\n📝 **Tavsif:** ${info.metaDesc}`;
                return bot.sendMessage(chatId, report, { reply_markup: UI.main(chatId) });
            }
        }
    }

    // B. Deploy Nome qabul qilish
    const state = userSteps[chatId];
    if (state?.step === 'wait_name') {
        const cleanName = text.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cleanName.length < 3) return bot.sendMessage(chatId, "⚠️ Ism juda qisqa!");
        
        userSteps[chatId] = { step: 'wait_file', pName: cleanName };
        return bot.sendMessage(chatId, `📂 Loyiha: **${cleanName}**\n\nEndi menga faylni yuboring:\n- .zip (Sayt uchun)\n- .pdf, .ppt, .jpg (Xosting uchun)`, { parse_mode: 'Markdown' });
    }
});

// ==========================================
// 7. FAYL DEPLOYMENT (ZIP & OTHERS)
// ==========================================
bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    const state = userSteps[chatId];
    if (state?.step !== 'wait_file') return;

    const loading = await bot.sendMessage(chatId, "🛰 **Fayl qabul qilinmoqda...**");

    try {
        const fileLink = await bot.getFileLink(msg.document.file_id);
        const fileName = msg.document.file_name;
        const ext = path.extname(fileName).toLowerCase();
        const userFolder = path.join(SITES_DIR, state.pName);
        
        await fs.ensureDir(userFolder);
        const tempPath = path.join(TEMP_DIR, `${Date.now()}_${fileName}`);

        // Yuklab olish
        const response = await axios({ url: fileLink, responseType: 'stream' });
        const writer = fs.createWriteStream(tempPath);
        response.data.pipe(writer);

        await new Promise((res, rej) => {
            writer.on('finish', res);
            writer.on('error', rej);
        });

        // Ishlov berish
        if (ext === '.zip') {
            const zip = new admZip(tempPath);
            zip.extractAllTo(userFolder, true);
        } else {
            await fs.move(tempPath, path.join(userFolder, fileName), { overwrite: true });
        }
        
        await fs.remove(tempPath);

        const finalUrl = `${BASE_URL}/${state.pName}/${ext === '.zip' ? 'index.html' : fileName}`;
        
        db.projects.push({ owner: chatId, name: state.pName, url: finalUrl, date: moment().format() });
        db.system.total_deploys++;
        saveDB();

        await bot.editMessageText(`✅ **Muvaffaqiyatli!**\n\n🔗 Havola: [Saytni ochish](${finalUrl})`, {
            chat_id: chatId, message_id: loading.message_id, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: "🌍 Ochish", url: finalUrl }], [{ text: "🏠 Menyu", callback_data: "act_home" }]] }
        });

        delete userSteps[chatId];
    } catch (err) {
        bot.editMessageText("❌ Xato: " + err.message, { chat_id: chatId, message_id: loading.message_id });
    }
});

// ==========================================
// 8. ADMIN VA STARTUP
// ==========================================
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (!db.users[chatId]) {
        db.users[chatId] = { name: msg.from.first_name, joined: moment().format() };
        saveDB();
    }
    bot.sendMessage(chatId, `🚀 **RunCloud Enterprise v5.2**\n\nXush kelibsiz, ${msg.from.first_name}! Tizim to'liq barqaror holatda.`, {
        parse_mode: 'Markdown', reply_markup: UI.main(chatId)
    });
});

// Static xosting
app.use(express.static(SITES_DIR));
app.listen(PORT, () => {
    console.log(`
    ╔════════════════════════════════════════╗
    ║ ☁️  RUNCLOUD CORE v5.2 ACTIVE           ║
    ║ 🚀 PORT: ${PORT}                      ║
    ╚════════════════════════════════════════╝
    `);
});

// Crash protection
process.on('uncaughtException', (err) => {
    console.error('SYSTEM CRASH PREVENTED:', err);
});