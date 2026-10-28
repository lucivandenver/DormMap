export const AuditLogModel = (sequelize, DataTypes) => sequelize.define('audit_log', {
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  action: { type: DataTypes.STRING, allowNull: false },
  resource_type: { type: DataTypes.STRING, allowNull: true },
  resource_id: { type: DataTypes.INTEGER, allowNull: true },
  ip_address: { type: DataTypes.STRING, allowNull: true },
  metadata: { type: DataTypes.JSON, allowNull: true },
});
