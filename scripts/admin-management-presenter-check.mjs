import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const source=await readFile(new URL('../admin/src/utils/managementPresenter.js',import.meta.url),'utf8')
const {creditRow,violationRow,posterRow,posterImageUrl}=await import('data:text/javascript,'+encodeURIComponent(source.replaceAll('import.meta.env','({})')))
const student=creditRow({id:7,real_name:'测试宿生',student_id:'2024001001',credit_score:0,restricted_until:'2026-10-08'})
assert.equal(student.creditScore,0);assert.equal(student.userId,7);assert.equal(student.userName,'测试宿生');assert.equal(student.banExpiresAt,'2026-10-08')
const violation=violationRow({real_name:'测试宿生',student_id:'2024001001',score:-20,created_at:'2026-10-07'})
assert.equal(violation.deduction,20);assert.equal(violation.studentId,'2024001001');assert.equal(violation.createdAt,'2026-10-07')
const poster=posterRow({real_name:'申请人',image_url:'/uploads/poster.png',start_date:'2026-10-07T00:00:00',end_date:'2026-10-09',position_name:'公告栏'})
assert.equal(poster.imageUrl,'/uploads/poster.png');assert.equal(poster.startDate,'2026-10-07');assert.equal(poster.userName,'申请人');assert.equal(poster.position,'公告栏')
assert.equal(posterImageUrl(''),'');assert.equal(posterImageUrl('javascript:alert(1)'),'');assert.equal(posterImageUrl('https://example.org/poster.png'),'https://example.org/poster.png')
console.log('PASS: desktop real response mapping, zero credit, actual deduction, poster dates and safe uploaded image URL')
