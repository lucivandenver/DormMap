import { Op } from 'sequelize';
import { User } from '../models/userModel.js';
export async function namedMessages(rows, currentUserId) {
  const ids=[...new Set(rows.flatMap(row=>[row.senderId,row.recipientId]))];
  const users=ids.length?await User.findAll({where:{id:{[Op.in]:ids}},attributes:['id','fullName']}):[];
  const names=new Map(users.map(user=>[Number(user.id),user.fullName]));
  return rows.map(row=>{const data=row.toJSON();const peerId=Number(row.senderId)===Number(currentUserId)?row.recipientId:row.senderId;return {...data,senderName:names.get(Number(row.senderId))||'Former user',recipientName:names.get(Number(row.recipientId))||'Former user',peerId,peerName:names.get(Number(peerId))||'Former user'};});
}
