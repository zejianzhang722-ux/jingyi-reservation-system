const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { auth, requireAdmin, requireRole } = require('../middleware/auth');
const multer = require('multer');
const config = require('../config');

const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, config.upload.dir);
  },
  filename: function(req, file, cb) {
    const ext = file.originalname.split('.').pop();
    cb(null, Date.now() + '-' + Math.random().toString(36).substring(2, 8) + '.' + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: config.upload.maxSize }
});

router.get('/accounts', auth, requireAdmin, adminController.getAccounts);
router.post('/accounts', auth, requireAdmin, adminController.createAccount);
router.put('/accounts/:id', auth, requireAdmin, adminController.updateAccount);
router.delete('/accounts/:id', auth, requireRole('super_admin'), adminController.deleteAccount);

router.get('/rooms', auth, requireAdmin, adminController.getRooms);
router.get('/rooms/:id', auth, requireAdmin, adminController.getRoomDetail);
router.get('/rooms/:id/seats', auth, requireAdmin, adminController.getSeatsByRoom);
router.post('/rooms', auth, requireAdmin, adminController.createRoom);
router.put('/rooms/:id', auth, requireAdmin, adminController.updateRoom);
router.delete('/rooms/:id', auth, requireRole('super_admin'), adminController.deleteRoom);

router.post('/seats/batch', auth, requireAdmin, adminController.batchCreateSeats);
router.put('/seats/:id', auth, requireAdmin, adminController.updateSeat);
router.delete('/seats/:id', auth, requireAdmin, adminController.deleteSeat);

router.get('/config', auth, requireAdmin, adminController.getConfig);
router.put('/config', auth, requireRole('super_admin'), adminController.updateConfig);

router.get('/buildings', auth, requireAdmin, adminController.getBuildings);
router.post('/buildings', auth, requireRole('super_admin'), adminController.createBuilding);
router.put('/buildings/:id', auth, requireRole('super_admin'), adminController.updateBuilding);
router.delete('/buildings/:id', auth, requireRole('super_admin'), adminController.deleteBuilding);

router.post('/managers', auth, requireRole('super_admin'), adminController.createManager);
router.put('/managers/:id', auth, requireRole('super_admin'), adminController.updateManager);
router.delete('/managers/:id', auth, requireRole('super_admin'), adminController.deleteManager);

router.get('/operation-logs', auth, requireAdmin, adminController.operationLogs);

router.get('/announcements', auth, requireAdmin, adminController.getAnnouncements);
router.post('/announcements', auth, requireAdmin, adminController.createAnnouncement);
router.put('/announcements/:id', auth, requireAdmin, adminController.updateAnnouncement);
router.delete('/announcements/:id', auth, requireAdmin, adminController.deleteAnnouncement);

router.post('/archive', auth, requireRole('super_admin'), adminController.archiveSemester);
router.post('/backup', auth, requireRole('super_admin'), adminController.backupData);

router.post('/upload', auth, requireAdmin, upload.single('file'), adminController.uploadFile);

module.exports = router;
