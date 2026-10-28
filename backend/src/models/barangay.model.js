export const BarangayModel = (sequelize, DataTypes) => sequelize.define('barangay', {
  name: { type: DataTypes.STRING, allowNull: false, unique: true },
  description: { type: DataTypes.TEXT, allowNull: true },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
  jurisdiction: { type: DataTypes.STRING, allowNull: true },
});
