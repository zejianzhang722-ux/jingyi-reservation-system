const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const accountController = require('../controllers/accountController');
const backupController = require('../controllers/backupController');
const secureUploadService = require('../services/secureUploadService');
const adminScope = require('../middleware/adminScope');
const { auth, requireAdmin, requireRole } = require('../middleware/auth');

router.get('/accounts', auth, requireRole('super_admin'), accountController.getAccounts);
router.post('/accounts', auth, requireRole('super_admin'), accountController.createAccount);
router.put('/accounts/:id', auth, requireRole('super_admin'), accountController.updateAccount);
router.delete('/accounts/:id', auth, requireRole('super_admin'), accountController.deleteAccount);

router.get('/rooms', auth, requireAdmin, adminScope.loadAdminScope, adminScope.forceBuildingQuery, adminController.getRooms);
router.get('/rooms/:id', auth, requireAdmin, adminScope.loadAdminScope, adminScope.roomFromParam('id'), adminController.getRoomDetail);
router.get('/rooms/:id/seats', auth, requireAdmin, adminScope.loadAdminScope, adminScope.roomFromParam('id'), adminController.getSeatsByRoom);
router.post('/rooms', auth, requireRole('super_admin'), adminController.createRoom);
router.put('/rooms/:id', auth, requireRole('super_admin'), adminController.updateRoom);
router.delete('/rooms/:id', auth, requireRole('super_admin'), adminController.deleteRoom);

router.post('/seats/batch', auth, requireRole('super_admin'), adminController.batchCreateSeats);
router.put('/seats/:id', auth, requireRole('super_admin'), adminController.updateSeat);
router.delete('/seats/:id', auth, requireRole('super_admin'), adminController.deleteSeat);

router.get('/config', auth, requireRole('super_admin'), adminController.getConfig);
router.put('/config', auth, requireRole('super_admin'), adminController.updateConfig);

router.get('/buildings', auth, requireAdmin, adminScope.loadAdminScope, adminScope.ownBuildingList, adminController.getBuildings);
router.post('/buildings', auth, requireRole('super_admin'), adminController.createBuilding);
router.put('/buildings/:id', auth, requireRole('super_admin'), adminController.updateBuilding);
router.delete('/buildings/:id', auth, requireRole('super_admin'), adminController.deleteBuilding);

router.get('/managers', auth, requireRole('super_admin'), accountController.getManagers);
router.post('/managers', auth, requireRole('super_admin'), accountController.createAccount);
router.put('/managers/:id', auth, requireRole('super_admin'), accountController.updateAccount);
router.delete('/managers/:id', auth, requireRole('super_admin'), accountController.deleteAccount);

router.get('/operation-logs', auth, requireRole('super_admin'), adminController.operationLogs);

router.get('/announcements', auth, requireAdmin, adminController.getAnnouncements);
router.post('/announcements', auth, requireRole('super_admin'), adminController.createAnnouncement);
router.put('/announcements/:id', auth, requireRole('super_admin'), adminController.updateAnnouncement);
router.delete('/announcements/:id', auth, requireRole('super_admin'), adminController.deleteAnnouncement);

router.post('/archive', auth, requireRole('super_admin'), adminController.archiveSemester);
router.get('/backups', auth, requireRole('super_admin'), backupController.list);
router.post('/backup', auth, requireRole('super_admin'), backupController.create);
router.post('/backups/:fileName/verify', auth, requireRole('super_admin'), backupController.verify);

router.post(
  '/upload',
  auth,
  requireAdmin,
  adminScope.loadAdminScope,
  secureUploadService.imageUpload('file', 'admin-image'),
  adminController.uploadFile
);

module.exports = router;
