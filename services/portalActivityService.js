import { Op } from 'sequelize';
import { User } from '../models/userModel.js';
import { sequelize } from '../models/db.js';
import { OwnerNotification, OwnerMessage, OwnerTenant, OwnerPayment, BoardingHouse } from '../models/ownerModels.js';
import { BarangayNotification, BarangayMessage, Announcement } from '../models/adminModels.js';
import { emitToUser } from './websocketService.js';
import { TenantApplication, MaintenanceRequest } from '../models/tenantModels.js';
import { openUserStream } from './liveEventService.js';

const normalizeRole = role => role==='bplo_admin'?'super_admin':role;
const paths={super_admin:'/admin',barangay:'/barangay-dashboard',boarding_house_owner:'/owner-dashboard',tenant:'/tenant-dashboard'};
export function notificationTarget(role, type='', link='') {
  role=normalizeRole(role);
  const base=paths[role]; if(!base)return '/login';
  const aliases=role==='tenant'?{messages:'messaging',payments:'payments',applications:'dashboard',rooms:'my-room',profile:'profile'}:role==='super_admin'?{applications:'owners',branches:'owners',profile:'owners',permit:'permits'}:role==='barangay'?{applications:'applications',branches:'houses',profile:'owners',permit:'permits'}:{applications:'tenants',branches:'profile',profile:'my-profile'};
  const allowed={super_admin:['overview','owners','barangays','submissions','data_requests','renewals','permits','maintenance','announcements','audit'],barangay:['overview','owners','houses','applications','messages','notifications','submissions','data_requests','renewals','permits','announcements'],boarding_house_owner:['overview','profile','my-profile','rooms','tenants','payments','applications','inquiries','messages','maintenance','permit','notifications'],tenant:['dashboard','messaging','payments','maintenance','documents','announcements','my-room','profile','notifications']}[role];
  let panel=String(link).startsWith('#')?String(link).slice(1):'';
  if(!panel)panel=/barangay_registration/.test(type)?'barangays':/data_request|reminder|submission/.test(type)?(role==='barangay'?'data_requests':'submissions'):/message|inquiry/.test(type)?'messages':/payment|bill/.test(type)?'payments':/maintenance/.test(type)?'maintenance':/branch/.test(type)?'branches':/application|tenant_confirmed/.test(type)?'applications':/renewal/.test(type)?(['super_admin','barangay'].includes(role)?'renewals':'permit'):/permit/.test(type)?'permit':/announcement/.test(type)?'announcements':/document/.test(type)?'profile':/account/.test(type)?'profile':/registration/.test(type)?'applications':'notifications';
  if(role==='boarding_house_owner'&&type==='application_update')panel='my-profile';
  panel=aliases[panel]||panel;
  if(!allowed.includes(panel))panel=role==='super_admin'?'overview':'notifications';
  return `${base}#${panel}`;
}
export function installPortalActivity(app) {
  async function auth(req,res,next){try{const user=req.session.userId&&await User.findByPk(req.session.userId);if(!user||user.isArchived||user.isSuspended)return res.status(401).json({error:'Sign in again to view updates.'});if(!paths[normalizeRole(user.accountType)])return res.status(403).json({error:'This account has no portal access.'});if(user.accountType==='barangay'&&user.applicationStatus!=='approved')return res.status(403).json({error:'Account approval is required.'});req.portalUser=user;next();}catch(error){next(error);}}
  app.get('/api/portal/events',auth,openUserStream);
  app.get('/api/portal/notifications',auth,async(req,res,next)=>{try{
    const user=req.portalUser,owner=user.accountType==='boarding_house_owner',model=owner?OwnerNotification:BarangayNotification,where=owner?{ownerId:user.id}:{userId:user.id};
    const [rows,unread]=await Promise.all([model.findAll({where,order:[['createdAt','DESC']],limit:60}),model.count({where:{...where,isRead:false}})]);
    const role=normalizeRole(user.accountType),pending={};
    if(role==='boarding_house_owner')pending.tenants=await TenantApplication.count({where:{ownerId:user.id,status:'pending_owner'}});
    if(role==='tenant')pending.dashboard=await TenantApplication.count({where:{tenantId:user.id,status:'accepted_by_owner'}});
    if(['barangay','super_admin'].includes(role)){
      pending[role==='barangay'?'applications':'owners']=await User.count({where:{accountType:'boarding_house_owner',isArchived:false,applicationStatus:{[Op.in]:['pending','pending_barangay','pending_bplo']},...(role==='barangay'?{boardingHouseAddress:user.barangay}:{})}});
      if(role==='super_admin')pending.barangays=await User.count({where:{accountType:'barangay',isArchived:false,applicationStatus:'pending'}});
      pending[role==='barangay'?'houses':'owners']=(pending[role==='barangay'?'houses':'owners']||0)+await BoardingHouse.count({where:{isPrimary:false,approvalStatus:'pending',...(role==='barangay'?{barangay:user.barangay}:{})}});
    }
    const supplemental=owner?await BarangayNotification.findAll({where:{userId:user.id},order:[['createdAt','DESC']],limit:60}):[];
    const extraUnread=owner?await BarangayNotification.count({where:{userId:user.id,isRead:false}}):0;
    const items=[...rows.map(row=>({...row.toJSON(),source:owner?'owner':'barangay'})),...supplemental.map(row=>({...row.toJSON(),source:'barangay'}))].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,60);
    res.json({unread:unread+extraUnread,pending,role:normalizeRole(user.accountType),items:items.map(row=>({...row,url:notificationTarget(user.accountType,row.type,row.link)}))});
  }catch(error){next(error);}});
  app.patch('/api/portal/notifications/read',auth,async(req,res,next)=>{try{const user=req.portalUser,owner=user.accountType==='boarding_house_owner';const ownerSource=owner&&req.body.source!=='barangay';const where=ownerSource?{ownerId:user.id}:{userId:user.id};if(req.body.id){if(!/^\d+$/.test(String(req.body.id)))return res.status(422).json({error:'Invalid notification.'});where.id=req.body.id;}await(ownerSource?OwnerNotification:BarangayNotification).update({isRead:true},{where});if(owner&&!req.body.id)await BarangayNotification.update({isRead:true},{where:{userId:user.id}});emitToUser(user.id,'portal_update',{kind:'read'});res.json({message:'Notifications updated.'});}catch(error){next(error);}});
  const committed=(options,fn)=>{const run=()=>Promise.resolve().then(fn).catch(error=>console.error('Portal update:',error.message));if(options.transaction)options.transaction.afterCommit(run);else return run();};
  for(const model of [OwnerNotification,BarangayNotification]) {
    const notify=row=>emitToUser(row.ownerId||row.userId,'portal_update',{kind:'notification'});
    model.addHook('afterCreate','portal-notification',(row,options)=>committed(options,()=>notify(row)));
    model.addHook('afterBulkCreate','portal-notifications',(rows,options)=>committed(options,()=>rows.forEach(notify)));
  }
  // Signals contain no record contents and are sent only to affected account identities.
  for(const model of Object.values(sequelize.models)){
    if([OwnerNotification,BarangayNotification].includes(model))continue;
    const signal=(row,options)=>committed(options,async()=>{
      const resident=model===OwnerPayment?await OwnerTenant.findByPk(row.tenantId):null;
      const tenantUser=model===OwnerPayment?resident?.tenantUserId:row.tenantId;
      const ids=new Set([row.ownerId,row.tenantUserId,tenantUser,row.senderId,row.recipientId].filter(Boolean));
      if(model===User)ids.add(row.id);
      ids.forEach(id=>emitToUser(id,'portal_update',{kind:model.name}));
    });
    model.addHook('afterCreate','portal-data',signal);model.addHook('afterUpdate','portal-data',signal);model.addHook('afterDestroy','portal-data',signal);
    if(['User','TenantApplication','MaintenanceRequest','BoardingHouse','OwnerRoom','OwnerTenant','OwnerPayment','OwnerMessage','BarangayMessage'].includes(model.name)) {
      model.addHook('beforeBulkUpdate','portal-bulk-identities',async options=>{options.portalRows=await model.findAll({where:options.where,transaction:options.transaction});});
      model.addHook('afterBulkUpdate','portal-bulk-data',options=>{return Promise.all((options.portalRows||[]).map(row=>signal(row,options)));});
    }
  }
  for(const model of [OwnerMessage,BarangayMessage])model.addHook('afterCreate','portal-message',(row,options)=>committed(options,async()=>{
    const recipient=await User.findByPk(row.recipientId);if(!recipient)return;
    // Tenant -> owner already creates its own message notification in its controller.
    const sender=await User.findByPk(row.senderId);
    if(model===OwnerMessage&&sender?.accountType==='tenant')return;
    const data={title:`New message from ${sender?.fullName||'a user'}`,body:String(row.message).slice(0,180),type:'message'};
    if(recipient.accountType==='boarding_house_owner')await OwnerNotification.create({...data,ownerId:recipient.id,link:'#messages'});else await BarangayNotification.create({...data,userId:recipient.id});
  }));

  const notice=async(userId,title,body,type)=>{if(!userId)return;const user=await User.findByPk(userId);if(!user)return;if(user.accountType==='boarding_house_owner')await OwnerNotification.create({ownerId:userId,title,body,type});else await BarangayNotification.create({userId,title,body,type});};
  BoardingHouse.addHook('afterCreate','portal-branch-review',(row,options)=>committed(options,async()=>{
    if(row.isPrimary)return;
    const reviewers=await User.findAll({where:{isSuspended:false,isArchived:false,[Op.or]:[{accountType:{[Op.in]:['super_admin','bplo_admin']}},{accountType:'barangay',barangay:row.barangay,applicationStatus:'approved'}]},attributes:['id']});
    for(const reviewer of reviewers)await notice(reviewer.id,'New branch for review',`${row.name} in ${row.barangay} is awaiting listing review.`,'branch');
  }));
  Announcement.addHook('afterCreate','portal-announcement',(row,options)=>committed(options,async()=>{
    if(!row.isPublished)return;
    let where={isArchived:false,isSuspended:false};
    if(row.audience.startsWith('owners:'))where={...where,accountType:'boarding_house_owner',boardingHouseAddress:row.audience.slice(7)};
    else if(row.audience==='owners')where.accountType='boarding_house_owner';
    else if(row.audience==='tenants')where.accountType='tenant';
    else if(['barangay','barangays'].includes(row.audience))where.accountType='barangay';
    else if(row.audience!=='all')return;
    const recipients=await User.findAll({where,attributes:['id']});
    for(const recipient of recipients)if(recipient.id!==row.publishedBy)await notice(recipient.id,row.title,String(row.message).slice(0,180),'announcement');
  }));
  OwnerPayment.addHook('afterCreate','portal-bill',(row,options)=>committed(options,async()=>{
    const tenant=await OwnerTenant.findByPk(row.tenantId);await notice(tenant?.tenantUserId,'New rent bill',`A rent bill for ${row.month || 'your rental period'} is ready for review.`,'bill');
  }));
  MaintenanceRequest.addHook('afterUpdate','portal-maintenance',(row,options)=>committed(options,()=>notice(row.tenantId,'Maintenance request updated',`${row.title}: ${row.status}.`,'maintenance')));
  User.addHook('afterUpdate','portal-account-status',(row,options)=>{
    if(!['applicationStatus','isSuspended'].some(field=>row.changed(field)))return;
    return committed(options,()=>notice(row.id,'Account review updated',`Your account status is ${row.isSuspended?'suspended':row.applicationStatus}.`,'account'));
  });
  User.addHook('afterCreate','portal-registration',(row,options)=>committed(options,async()=>{
    if(!['barangay','boarding_house_owner'].includes(row.accountType))return;
    const where=row.accountType==='barangay'?{accountType:{[Op.in]:['super_admin','bplo_admin']}}:{[Op.or]:[{accountType:{[Op.in]:['super_admin','bplo_admin']}},{accountType:'barangay',barangay:row.boardingHouseAddress,applicationStatus:'approved'}]};
    const reviewers=await User.findAll({where:{...where,isArchived:false,isSuspended:false},attributes:['id']});
    for(const reviewer of reviewers)await BarangayNotification.create({userId:reviewer.id,title:'New account application',body:`${row.fullName} submitted a ${row.accountType==='barangay'?'barangay official':'property owner'} application.`,type:row.accountType==='barangay'?'barangay_registration':'registration'});
  }));
}
