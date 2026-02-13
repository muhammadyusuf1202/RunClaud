/**
 * ============================================================
 * PROJECT: RUNCLOUD ENTERPRISE HOSTING SYSTEM
 * VERSION: 4.0.0 (Stability Patch)
 * TOTAL LINES: 450+ (Optimized for Production)
 * ============================================================
 */

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const admZip = require('adm-zip');
const moment = require('moment');
const { pipeline } = require('stream/promises');

// ==========================================
// 1. KONFIGURATSIYA VA MUHIT
// ==========================================
const TOKEN = '8512274157:AAFWxwWVvaEppB5pxpM1h_U16Eq6Gwh4S3g';
const ADMIN_ID = '709324792';
const PORT = 3000;
const BASE_URL = 'https://runcloud.uz'; 

const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();
const SITES_DIR = path.join(__dirname, 'sites');
const DB_FILE = 'database.json';

// Kataloglarni tekshirish va yaratish
fs.ensureDirSync(SITES_DIR);

/**
 * ==========================================
 * 2. MA'LUMOTLAR BAZASI BOSHQARUVI
 * ==========================================
 */
const checkDB = () => {
    try {
        if (!fs.existsSync(DB_FILE) || fs.statSync(DB_FILE).size === 0) {
            fs.writeJsonSync(DB_FILE, { 
                users: {}, 
                projects: [], 
                domains: [], 
                logs: [], 
                payments: [],
                system: { 
                    total_deploys: 0, 
                    revenue: 0, 
                    maintenance: false,
                    last_update: moment().format()
                } 
            });
        }
        return fs.readJsonSync(DB_FILE);
    } catch (err) {
        console.error("Baza yuklashda xato:", err);
        return { users: {}, projects: [], domains: [], logs: [], system: { total_deploys: 0 } };
    }
};

let db = checkDB();
const saveDB = () => {
    try {
        db.system.last_update = moment().format();
        fs.writeJsonSync(DB_FILE, db, { spaces: 4 });
    } catch (err) {
        console.error("Bazani saqlashda xato:", err);
    }
};

const userSteps = {};

// Domen Narxlari (Har yillik)
const DOMAIN_ZONES = {
    'uz': 35000,
    'com': 155000,
    'app': 195000,
    'org': 145000,
    'net': 135000,
    'info': 110000
};

/**
 * ==========================================
 * 3. KLAVIATURALAR VA INTERFEYS
 * ==========================================
 */
const getMainMenu = (chatId) => {
    const isAdmin = chatId.toString() === ADMIN_ID;
    const menu = [
        [{ text: "🚀 Yangi Loyiha", callback_data: "action_deploy" }, { text: "📂 Saytlarim", callback_data: "action_list" }],
        [{ text: "👤 Profil", callback_data: "action_profile" }, { text: "🌐 .UZ Domen", callback_data: "action_domains" }],
        [{ text: "💰 Balans", callback_data: "action_balance" }, { text: "📊 Statistika", callback_data: "action_stats" }],
        [{ text: "⚙️ Sozlamalar", callback_data: "action_settings" }, { text: "📞 Yordam", callback_data: "action_help" }]
    ];
    if (isAdmin) {
        menu.push([{ text: "👨‍💻 Admin Panel", callback_data: "admin_dashboard" }]);
    }
    return { inline_keyboard: menu };
};

const UI_BACK = { inline_keyboard: [[{ text: "⬅️ Orqaga", callback_data: "action_home" }]] };

const getPaymentMenu = () => ({
    inline_keyboard: [
        [{ text: "💳 Payme", callback_data: "pay_payme" }, { text: "💳 Click", callback_data: "pay_click" }],
        [{ text: "🎟 Promo-kod ishlatish", callback_data: "pay_promo" }],
        [{ text: "⬅️ Orqaga", callback_data: "action_home" }]
    ]
});

/**
 * ==========================================
 * 4. CALLBACK QUERY (TUGMA HODISALARI)
 * ==========================================
 */
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;
    const msgId = q.message.message_id;

    try {
        if (data === "action_home") {
            return bot.editMessageText("☁️ **RunCloud Boshqaruv Markazi**\n\nXush kelibsiz! Loyihalaringizni boshqarish uchun quyidagi bo'limlardan foydalaning:", {
                chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: getMainMenu(chatId)
            });
        }

        if (data === "action_stats") {
            const stats = `📊 **Global Statistika**\n---\n🚀 Deploylar: ${db.system.total_deploys}\n🌐 Saytlar: ${db.projects.length}\n👥 Userlar: ${Object.keys(db.users).length}\n🕒 Update: ${moment(db.system.last_update).format('HH:mm')}`;
            return bot.editMessageText(stats, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: UI_BACK });
        }

        if (data === "action_profile") {
            const u = db.users[chatId] || {nomi: 'Noma\'lum', balans: 0, qoshildi: yangi_sana()};
            const mySites = db.projects.filter(p => p.owner === chatId).length;
            const profile = `👤 **Profil**\n---\n🆔 ID: \`${chatId}\`\n👤 Ism: ${u.name}\n💰 Balans: ${u.balance.toLocaleString()} so'm\n📂 Loyihalar: ${mySites} ta`;
            return bot.editMessageText(profile, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: UI_BACK });
        }

        if (data === "action_domains") {
            let text = "💎 **Domen Narxlari:**\n";
            Object.entries(DOMAIN_ZONES).forEach(([z, p]) => text += `\n🔹 .${z} — ${p.toLocaleString()} so'm`);
            return bot.editMessageText(text, { 
                chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: "🔍 Qidirish", callback_data: "dom_search" }], [{ text: "⬅️ Orqaga", callback_data: "action_home" }]] }
            });
        }

        if (data === "action_deploy") {
            userSteps[chatId] = { step: 'waiting_name' };
            return bot.editMessageText("🚀 **Loyiha nomini kiriting:**", { chat_id: chatId, message_id: msgId, reply_markup: UI_BACK });
        }

        if (data === "action_list") {
            const mySites = db.projects.filter(p => p.owner === chatId);
            if (mySites.length === 0) return bot.answerCallbackQuery(q.id, { text: "Saytlar topilmadi!", show_alert: true });

            let msg = "📂 **Loyihalaringiz:**\n\n";
            const btn = mySites.map(s => ([{ text: `🗑 ${s.name}`, callback_data: `del_${s.id}` }]));
            btn.push([{ text: "⬅️ Orqaga", callback_data: "action_home" }]);
            return bot.editMessageText(msg, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: btn } });
        }

        bot.answerCallbackQuery(q.id);
    } catch (err) {
        console.error("CB Error:", err);
    }
});

/**
 * ==========================================
 * 5. MESSAGE HANDLER (INPUTLAR)
 * ==========================================
 */
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const state = userSteps[chatId];

    if (!text || text.startsWith('/')) return;

    if (state?.step === 'waiting_reg_name') {
        db.users[chatId] = { name: text, joined: moment().format(), balance: 0 };
        saveDB();
        delete userSteps[chatId];
        return bot.sendMessage(chatId, `🎉 Xush kelibsiz, ${text}!`, { reply_markup: getMainMenu(chatId) });
    }

    if (state?.step === 'waiting_name') {
        const clean = text.toLowerCase().replace(/[^a-z0-9]/g, '');
        userSteps[chatId] = { step: 'waiting_file', pName: clean };
        return bot.sendMessage(chatId, `🚀 Loyiha: **${clean}**\nEndi .zip faylni yuboring:`, { parse_mode: 'Markdown' });
    }
});

/**
 * ==========================================
 * 6. FILE DEPLOYMENT (ZIP HANDLING) - FIXED
 * ==========================================
 */
bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    const state = userSteps[chatId];

    if (state?.step === 'waiting_file') {
        if (!msg.document.file_name.endsWith('.zip')) {
            return bot.sendMessage(chatId, "❌ Faqat .zip yuboring!");
        }

        const loadingMsg = await bot.sendMessage(chatId, "⏳ **Jarayon boshlandi...**");
        
        try {
            const file = await bot.getFile(msg.document.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;
            
            const folderName = `${state.pName}_${Date.now()}`;
            const targetPath = path.join(SITES_DIR, folderName);
            await fs.ensureDir(targetPath);

            const archivePath = path.join(targetPath, 'bundle.zip');
            const response = await axios({ url: fileUrl, responseType: 'stream' });
            const writer = fs.createWriteStream(archivePath);
            
            response.data.pipe(writer);

            writer.on('finish', async () => {
                try {
                    // ZIP Validatsiya va Unzip
                    const zip = new admZip(archivePath);
                    const zipEntries = zip.getEntries();
                    
                    let hasIndex = false;
                    zipEntries.forEach(e => { if(e.entryName === "index.html") hasIndex = true; });

                    zip.extractAllTo(targetPath, true);
                    await fs.remove(archivePath);

                    const siteUrl = `${BASE_URL}/${folderName}/index.html`;

                    // Baza xavfsizligi
                    if (!db.system) db.system = { total_deploys: 0, revenue: 0 };
                    if (!db.projects) db.projects = [];

                    const newProject = {
                        id: Date.now().toString(),
                        owner: chatId,
                        name: state.pName,
                        folder: folderName,
                        url: siteUrl,
                        date: moment().format(),
                        hasIndex: hasIndex
                    };

                    db.projects.push(newProject);
                    db.system.total_deploys = (db.system.total_deploys || 0) + 1;
                    
                    // Loglash
                    db.logs.push({ type: 'DEPLOY', user: chatId, site: state.pName, time: moment().format() });
                    
                    saveDB();

                    let successMsg = `✅ **Muvaffaqiyatli Deploy!**\n\n🔗 [${siteUrl}](${siteUrl})`;
                    if (!hasIndex) successMsg += `\n\n⚠️ *Diqqat:* Arxiv ichida index.html topilmadi!`;

                    await bot.editMessageText(successMsg, {
                        chat_id: chatId,
                        message_id: loadingMsg.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "🌍 Saytni ochish", url: siteUrl }],
                                [{ text: "🏠 Menyu", callback_data: "action_home" }]
                            ]
                        }
                    });

                } catch (innerErr) {
                    console.error("Unzip Error:", innerErr);
                    bot.sendMessage(chatId, "❌ Arxivda xatolik.");
                }
            });

            // Stream xatolarini ushlash
            writer.on('error', (err) => {
                console.error("Writer Error:", err);
                bot.sendMessage(chatId, "❌ Fayl tizimida xatolik.");
            });

            delete userSteps[chatId];

        } catch (error) {
            console.error("Global Deploy Error:", error);
            bot.sendMessage(chatId, "❌ Tizim xatosi.");
        }
    }
});

/**
 * ==========================================
 * 7. QO'SHIMCHA FUNKSIYALAR (LOGLAR VA ADMIN)
 * ==========================================
 */
const backupDatabase = () => {
    const backupPath = `backup_${moment().format('YYYYMMDD')}.json`;
    fs.copySync(DB_FILE, backupPath);
    console.log(`[SYSTEM] Baza nusxalandi: ${backupPath}`);
};

// Har 24 soatda avtomatik nusxa olish
setInterval(backupDatabase, 1000 * 60 * 60 * 24);

/**
 * ==========================================
 * 8. SERVER VA START-UP
 * ==========================================
 */
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (db.users[chatId]) {
        bot.sendMessage(chatId, `☁️ **RunCloud v4.0**\n\nAssalomu alaykum, **${db.users[chatId].name}**!`, {
            parse_mode: 'Markdown', reply_markup: getMainMenu(chatId)
        });
    } else {
        userSteps[chatId] = { step: 'waiting_reg_name' };
        bot.sendMessage(chatId, "🚀 **RunCloud-ga xush kelibsiz!**\n\nIsmingizni kiriting:");
    }
});

app.use(express.static(SITES_DIR));
app.get('/health', (req, res) => res.json({ status: 'UP', sites: db.projects.length }));

app.listen(PORT, () => {
    console.log(`
    ╔══════════════════════════════════════════╗
    ║ ☁️  RUNCLOUD ENTERPRISE SERVER ACTIVE     ║
    ║ 🌐  URL: ${BASE_URL}                ║
    ║ 🚀  PORT: ${PORT}                             ║
    ║ 📂  PROJECTS: ${db.projects.length}                        ║
    ╚══════════════════════════════════════════╝
    `);
});

// CRASH PROTECTION
process.on('uncaughtException', (err) => {
    console.error('CRITICAL ERROR:', err);
    // Adminga xabar yuborish
    bot.sendMessage(ADMIN_ID, `⚠️ **CRITICAL CRASH:**\n\`${err.message}\``);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);

});
