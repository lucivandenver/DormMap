export const MessageModel = (sequelize, DataTypes) => sequelize.define('message', {
  sender_id: { type: DataTypes.INTEGER, allowNull: false },
  recipient_id: { type: DataTypes.INTEGER, allowNull: false },
  room: { type: DataTypes.STRING, allowNull: true },
  content: { type: DataTypes.TEXT, allowNull: false },
  metadata: { type: DataTypes.JSON, allowNull: true },
  is_read: { type: DataTypes.BOOLEAN, defaultValue: false },
});
