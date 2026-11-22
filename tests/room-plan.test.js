import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offerMoveInDate } from '../services/occupancyService.js';
import { parseRoomPlan, floorLabel } from '../services/roomPlanService.js';
import { validateOwnerSetup, validateOwnerPaymentSetup } from '../services/ownerRegistrationService.js';
const bed = { roomNumber:'101',floor:1,roomType:'Bedspace',rentalBasis:'bed',capacity:6,bedCount:6,unavailable:2,rentalPrice:1500 };
test('registration plan keeps floors, bedspace availability and whole-room rates distinct',()=>{
 const rows=parseRoomPlan([bed,{roomNumber:'101',floor:2,roomType:'Family Room',rentalBasis:'room',capacity:4,bedCount:2,rentalPrice:6500}],2);
 assert.equal(rows[0].availableSlots,4);assert.equal(rows[0].reservedSlots,2);
 assert.equal(rows[1].bedCount,2);assert.equal(rows[1].rentalBasis,'room');assert.equal(rows[1].floor,'2nd Floor');assert.equal(floorLabel(11),'11th Floor');
});
test('invalid capacities, floors, prices and duplicate room/floor identities are rejected',()=>{
 assert.throws(()=>parseRoomPlan([bed,{...bed}],2),/duplicated/);
 assert.throws(()=>parseRoomPlan([{...bed,floor:3}],2),/valid floor/);
 assert.throws(()=>parseRoomPlan([{...bed,bedCount:2}],2),/must match/);
 assert.throws(()=>parseRoomPlan([{...bed,unavailable:7}],2),/capacity/);
 assert.throws(()=>parseRoomPlan([{...bed,rentalPrice:-1}],2),/positive/);
 assert.throws(()=>parseRoomPlan([],1),/Add between/);
});
test('required photos/documents and a real map pin are enforced on the server',()=>{
 const body={declaredBranches:1,roomsAvailable:3,floorCount:2,boardingHouseAddress:'Orconuma',streetAddress:'  Purok 2, Main Street  ',boardingHouseLatitude:'12.668945',boardingHouseLongitude:'121.491777'};
 assert.throws(()=>validateOwnerSetup(body,{}),/upload/);
 const fields=['profilePicture','galleryOutdoor','galleryLivingArea','galleryBedroom','galleryDining','galleryBathroom','validIdPicture','businessPermit','barangayClearance','proofOfOwnership','rentalPermit'];
 const files=Object.fromEntries(fields.map(name=>[name,[{mimetype:'image/png',size:100}]]));
 assert.equal(validateOwnerSetup(body,files).metadata.declaredRooms,3);
 assert.throws(() => validateOwnerSetup({...body, streetAddress:'   '},files), /street address for branch 1/);
 assert.throws(() => validateOwnerSetup({...body, streetAddress:'orconuma'},files), /street address for branch 1/);
 assert.throws(() => validateOwnerSetup({...body, declaredBranches:2},files), /branch 2/);
 const crossBarangay = {...body, declaredBranches:2, branchFloors2:4, branchRooms2:9,
   branch2_boardingHouseAddress:'Labasan', branch2_streetAddress:'Centro',
   branch2_boardingHouseLatitude:'12.774815', branch2_boardingHouseLongitude:'121.470195'};
 assert.throws(() => validateOwnerSetup({...crossBarangay, branch2_streetAddress:''},files), /street address for branch 2/);
 assert.throws(() => validateOwnerSetup(crossBarangay, files), /Outdoor Spaces for branch 2/);
 const branchPhotos = Object.fromEntries(fields.filter(field => field.startsWith('gallery'))
   .map(field => ['branch2_' + field, files[field]]));
 assert.deepEqual(validateOwnerSetup(crossBarangay, {...files, ...branchPhotos}).branches, [
   {floors:2, rooms:3, barangay:'Orconuma', latitude:12.668945, longitude:121.491777, mapPin:'Lat 12.668945, Lon 121.491777', address:'Purok 2, Main Street'},
   {floors:4, rooms:9, barangay:'Labasan', latitude:12.774815, longitude:121.470195, mapPin:'Lat 12.774815, Lon 121.470195', address:'Centro'}
 ]);
 assert.equal(validateOwnerSetup(crossBarangay, {...files, ...branchPhotos, branch2_galleryExtra3: files.galleryOutdoor}).branches.length, 2);
 assert.throws(() => validateOwnerSetup(crossBarangay, {...files, ...branchPhotos, branch2_galleryExtra3: [{mimetype:'application/pdf', size:100}]}), /Extra Photo 3 for branch 2/);
 assert.throws(() => validateOwnerSetup({...crossBarangay, branch2_boardingHouseAddress:'Outside Bongabong'}, {...files, ...branchPhotos}), /barangay for branch 2/);
 files.galleryOutdoor[0].mimetype='application/pdf';assert.throws(()=>validateOwnerSetup(body,files),/Invalid file/);
 files.galleryOutdoor[0].mimetype='image/png';assert.throws(()=>validateOwnerSetup({...body,boardingHouseLatitude:''},files),/actual Bongabong/);
});

test('a reported unavailable whole-room lease is not advertised as partial bedspace availability',()=>{
 const [room]=parseRoomPlan([{roomNumber:'F1',floor:1,roomType:'Family Room',rentalBasis:'room',capacity:4,bedCount:2,unavailable:2,rentalPrice:6000}],1);
 assert.equal(room.availableSlots,0);assert.equal(room.reservedSlots,2);assert.equal(room.status,'occupied');
});

test('registration accepts selected payment methods before the owner uploads QR codes', () => {
 const contactNumber = '09171234567';
 assert.deepEqual(validateOwnerPaymentSetup({ contactNumber, paymentMethods: 'Cash' }, {}), {
   contactNumber, paymentMethods: '["Cash"]', rentPerRoom: null, rentPerHead: null, qrUploads: { gcashQrCode: null, qrPhCode: null }
 });
 assert.deepEqual(validateOwnerPaymentSetup({ contactNumber, paymentMethods: ['Cash', 'GCash', 'QR Ph'] }, {}), {
   contactNumber, paymentMethods: '["Cash","GCash","QR Ph"]', rentPerRoom: null, rentPerHead: null, qrUploads: { gcashQrCode: null, qrPhCode: null }
 });
 const rates = validateOwnerPaymentSetup({ contactNumber, paymentMethods: 'Cash', rentPerRoom: '3200', rentPerHead: '1000' }, {});
 assert.equal(rates.rentPerRoom, 3200);
 assert.equal(rates.rentPerHead, 1000);
 assert.throws(() => validateOwnerPaymentSetup({ contactNumber, paymentMethods: 'Cash', rentPerRoom: '-1' }, {}), /valid monthly rent per room/);
 assert.throws(() => validateOwnerPaymentSetup({ contactNumber }, {}), /Select at least one/);
 const qr = { mimetype: 'image/png' };
 assert.equal(validateOwnerPaymentSetup({ contactNumber, paymentMethods: 'GCash' }, { gcashQrCode: [qr] }).qrUploads.gcashQrCode, qr);
});

test('rental offers preserve each calendar date and reject invalid dates', () => {
  assert.equal(offerMoveInDate('2027-01-04'), '2027-01-04');
  assert.equal(offerMoveInDate('2027-01-22'), '2027-01-22');
  assert.equal(offerMoveInDate(''), null);
  assert.throws(() => offerMoveInDate('2027-02-29'), /valid move-in date/);
  assert.throws(() => offerMoveInDate('tomorrow'), /valid move-in date/);
});
