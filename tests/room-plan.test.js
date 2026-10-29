import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoomPlan, floorLabel } from '../services/roomPlanService.js';
import { validateOwnerSetup } from '../services/ownerRegistrationService.js';
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
 const body={roomPlan:JSON.stringify([bed]),floorCount:2,boardingHouseLatitude:'12.668945',boardingHouseLongitude:'121.491777'};
 assert.throws(()=>validateOwnerSetup(body,{}),/upload/);
 const fields=['profilePicture','galleryOutdoor','galleryLivingArea','galleryBedroom','galleryDining','galleryBathroom','validIdPicture','businessPermit','barangayClearance','proofOfOwnership','rentalPermit'];
 const files=Object.fromEntries(fields.map(name=>[name,[{mimetype:'image/png',size:100}]]));
 assert.equal(validateOwnerSetup(body,files).rooms[0].availableSlots,4);
 files.galleryOutdoor[0].mimetype='application/pdf';assert.throws(()=>validateOwnerSetup(body,files),/Invalid file/);
 files.galleryOutdoor[0].mimetype='image/png';assert.throws(()=>validateOwnerSetup({...body,boardingHouseLatitude:''},files),/actual Bongabong/);
});

test('a reported unavailable whole-room lease is not advertised as partial bedspace availability',()=>{
 const [room]=parseRoomPlan([{roomNumber:'F1',floor:1,roomType:'Family Room',rentalBasis:'room',capacity:4,bedCount:2,unavailable:2,rentalPrice:6000}],1);
 assert.equal(room.availableSlots,0);assert.equal(room.reservedSlots,2);assert.equal(room.status,'occupied');
});
