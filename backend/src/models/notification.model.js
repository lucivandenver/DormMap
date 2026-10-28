export const NotificationModel = (sequelize, DataTypes) => sequelize.define('notification', {
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  title: { type: DataTypes.STRING, allowNull: false },
  body: { type: DataTypes.TEXT, allowNull: false },
  type: { type: DataTypes.STRING, allowNull: true },
  data: { type: DataTypes.JSON, allowNull: true },
  is_read: { type: DataTypes.BOOLEAN, defaultValue: false },
});
