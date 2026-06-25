const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const secureUploadService = require('../services/secureUploadService');
const adminScope = require('../middleware/adminScope');
const { auth, requireAdmin, requireRole } = require('../middleware/auth');

router.get('/accounts', auth, requireRole('super_admin'), adminController.getAccounts);
router.post('/accounts', auth, requireRole('super_admin'), adminController.createAccount);
router.put('/accounts/:id', auth, requireRole('super_admin'), adminController.updateAccount);
router.delete('/accounts/:id', auth, requireRole('super_admin'), adminController.deleteAccount);

router.get('/rooms', auth, requireAdmin, adminScope.loadAdminScope, adminScope.forceBuildingQuery, adminController.getRooms);
router.get('/rooms/:id', auth, requireAdmin, adminScope.loadAdminScope, adminScope.roomFromParam('id'), adminController.getRoomDetail);
router.get('/rooms/:id/seats', auth, requireAdmin, adminScope.loadAdminScope, adminScope.roomFromParam('id'), adminController.getSeatsByRoom);
router.post('/rooms', auth, requireAdmin, adminScope.loadAdminScope, adminScope.enforceBodyBuilding(), adminController.createRoom);
router.put('/rooms/:id', auth, requireAdmin, adminScope.loadAdminScope, adminScope.roomFromParam('id'), adminScope.enforceBodyBuilding(), adminController.updateRoom);
router.delete('/rooms/:id', auth, requireRole('super_admin'), adminController.deleteRoom);

router.post('/seats/batch', auth, requireAdmin, adminScope.loadAdminScope, adminScope.roomFromBody('roomId'), adminController.batchCreateSeats);
router.put('/seats/:id', auth, requireAdmin, adminScope.loadAdminScope, adminScope.seatFromParam('id'), adminController.updateSeat);
router.delete('/seats/:id', auth, requireAdmin, adminScope.loadAdminScope, adminScope.seatFromParam('id'), adminController.deleteSeat);

router.get('/config', auth, requireRole('super_admin'), adminController.getConfig);
router.put('/config', auth, requireRole('super_admin'), adminController.updateConfig);

router.get('/buildings', auth, requireAdmin, adminScope.loadAdminScope, adminScope.ownBuildingList, adminController.getBuildings);
router.post('/buildings', auth, requireRole('super_admin'), adminController.createBuilding);
router.put('/buildings/:id', auth, requireRole('super_admin'), adminController.updateBuilding);
router.delete('/buildings/:id', auth, requireRole('super_admin'), adminController.deleteBuilding);

router.post('/managers', auth, requireRole('super_admin'), adminController.createManager);
router.put('/managers/:id', auth, requireRole('super_admin'), adminController.updateManager);
router.delete('/managers/:id', auth, requireRole('super_admin'), adminController.deleteManager);

router.get('/operation-logs', auth, requireRole('super_admin'), adminController.operationLogs);

router.get('/announcements', auth, requireAdmin, adminController.getAnnouncements);
router.post('/announcements', auth, requireAdmin, adminController.createAnnouncement);
router.put('/announcements/:id', auth, requireAdmin, adminController.updateAnnouncement);
router.delete('/announcements/:id', auth, requireAdmin, adminController.deleteAnnouncement);

router.post('/archive', auth, requireRole('super_admin'), adminController.archiveSemester);
router.post('/backup', auth, requireRole('super_admin'), adminController.backupData);

router.post(
  '/upload',
  auth,
  requireAdmin,
  adminScope.loadAdminScope,
  secureUploadService.imageUpload('file', 'admin-image'),
  adminController.uploadFile
);

module.exports = router;
