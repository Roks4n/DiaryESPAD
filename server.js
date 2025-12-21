const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/lab_tracker', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// Модели
const UserSchema = new mongoose.Schema({
    vkId: { type: String, unique: true },
    email: String,
    name: String,
    avatar: String,
    provider: String,
    createdAt: { type: Date, default: Date.now }
});

const LabTrackerDataSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    educations: [{
        id: Number,
        name: String
    }],
    currentEducationId: Number,
    subjects: [{
        id: Number,
        educationId: Number,
        name: String,
        totalLabs: Number,
        labs: [{
            number: Number,
            done: Boolean,
            passed: Boolean,
            grade: Number
        }]
    }],
    lastUpdated: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const LabTrackerData = mongoose.model('LabTrackerData', LabTrackerDataSchema);

// JWT секретный ключ
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Middleware для проверки JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: 'Токен не предоставлен' });
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Неверный токен' });
        req.user = user;
        next();
    });
};

// ========== API РОУТЫ ==========

// 1. Регистрация/логин через VK
app.post('/api/auth/vk', async (req, res) => {
    try {
        const { vkId, email, name, avatar } = req.body;
        
        // Ищем или создаем пользователя
        let user = await User.findOne({ vkId });
        
        if (!user) {
            user = new User({
                vkId,
                email,
                name,
                avatar,
                provider: 'vk'
            });
            await user.save();
            
            // Создаем начальные данные для нового пользователя
            const initialData = new LabTrackerData({
                userId: user._id,
                educations: [{ id: 1, name: "Бакалавриат" }],
                currentEducationId: 1,
                subjects: []
            });
            await initialData.save();
        }
        
        // Создаем JWT токен
        const token = jwt.sign(
            { userId: user._id, vkId: user.vkId },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            token,
            user: {
                id: user._id,
                vkId: user.vkId,
                name: user.name,
                email: user.email,
                avatar: user.avatar,
                provider: user.provider
            }
        });
        
    } catch (error) {
        console.error('VK auth error:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// 2. Получение данных пользователя
app.get('/api/data', authenticateToken, async (req, res) => {
    try {
        const data = await LabTrackerData.findOne({ userId: req.user.userId });
        
        if (!data) {
            // Создаем начальные данные если их нет
            const newData = new LabTrackerData({
                userId: req.user.userId,
                educations: [{ id: 1, name: "Бакалавриат" }],
                currentEducationId: 1,
                subjects: []
            });
            await newData.save();
            return res.json(newData);
        }
        
        res.json(data);
    } catch (error) {
        console.error('Get data error:', error);
        res.status(500).json({ error: 'Ошибка получения данных' });
    }
});

// 3. Сохранение данных
app.post('/api/data', authenticateToken, async (req, res) => {
    try {
        const { educations, currentEducationId, subjects } = req.body;
        
        let data = await LabTrackerData.findOne({ userId: req.user.userId });
        
        if (!data) {
            data = new LabTrackerData({
                userId: req.user.userId,
                educations,
                currentEducationId,
                subjects
            });
        } else {
            data.educations = educations;
            data.currentEducationId = currentEducationId;
            data.subjects = subjects;
            data.lastUpdated = new Date();
        }
        
        await data.save();
        res.json({ success: true, message: 'Данные сохранены' });
        
    } catch (error) {
        console.error('Save data error:', error);
        res.status(500).json({ error: 'Ошибка сохранения данных' });
    }
});

// 4. Резервное копирование (экспорт)
app.get('/api/backup', authenticateToken, async (req, res) => {
    try {
        const data = await LabTrackerData.findOne({ userId: req.user.userId });
        const user = await User.findById(req.user.userId);
        
        if (!data || !user) {
            return res.status(404).json({ error: 'Данные не найдены' });
        }
        
        const backupData = {
            user: {
                id: user._id,
                vkId: user.vkId,
                name: user.name,
                email: user.email,
                provider: user.provider
            },
            appData: {
                educations: data.educations,
                currentEducationId: data.currentEducationId,
                subjects: data.subjects
            },
            exportDate: new Date().toISOString(),
            version: '1.0'
        };
        
        res.json(backupData);
        
    } catch (error) {
        console.error('Backup error:', error);
        res.status(500).json({ error: 'Ошибка создания бэкапа' });
    }
});

// 5. Восстановление (импорт)
app.post('/api/restore', authenticateToken, async (req, res) => {
    try {
        const { appData } = req.body;
        
        let data = await LabTrackerData.findOne({ userId: req.user.userId });
        
        if (!data) {
            data = new LabTrackerData({
                userId: req.user.userId,
                ...appData
            });
        } else {
            data.educations = appData.educations;
            data.currentEducationId = appData.currentEducationId;
            data.subjects = appData.subjects;
            data.lastUpdated = new Date();
        }
        
        await data.save();
        res.json({ success: true, message: 'Данные восстановлены' });
        
    } catch (error) {
        console.error('Restore error:', error);
        res.status(500).json({ error: 'Ошибка восстановления данных' });
    }
});

// 6. Получение статистики пользователя
app.get('/api/stats', authenticateToken, async (req, res) => {
    try {
        const data = await LabTrackerData.findOne({ userId: req.user.userId });
        
        if (!data) {
            return res.json({
                totalSubjects: 0,
                completedSubjects: 0,
                overallProgress: 0,
                overallAverage: 0
            });
        }
        
        const currentSubjects = data.subjects.filter(s => 
            s.educationId === data.currentEducationId
        );
        
        // Расчет статистики
        const totalSubjects = currentSubjects.length;
        const completedSubjects = currentSubjects.filter(subject => {
            const doneLabs = subject.labs.filter(lab => lab.done).length;
            const passedLabs = subject.labs.filter(lab => lab.passed).length;
            return doneLabs === subject.totalLabs && passedLabs === subject.totalLabs;
        }).length;
        
        const totalLabs = currentSubjects.reduce((sum, s) => sum + s.totalLabs, 0);
        const passedLabs = currentSubjects.reduce((sum, subject) => {
            return sum + subject.labs.filter(lab => lab.passed).length;
        }, 0);
        const overallProgress = totalLabs > 0 ? Math.round((passedLabs / totalLabs) * 100) : 0;
        
        let totalAverage = 0;
        let subjectsWithGrades = 0;
        
        currentSubjects.forEach(subject => {
            const passedLabs = subject.labs.filter(lab => lab.passed && lab.grade !== null);
            if (passedLabs.length > 0) {
                const avg = passedLabs.reduce((sum, lab) => sum + lab.grade, 0) / passedLabs.length;
                totalAverage += avg;
                subjectsWithGrades++;
            }
        });
        
        const overallAverage = subjectsWithGrades > 0 ? (totalAverage / subjectsWithGrades) : 0;
        
        res.json({
            totalSubjects,
            completedSubjects,
            overallProgress,
            overallAverage: parseFloat(overallAverage.toFixed(1))
        });
        
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Ошибка получения статистики' });
    }
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
