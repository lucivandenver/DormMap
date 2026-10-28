export const UserModel = (sequelize, DataTypes) => sequelize.define('user', {
  full_name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  password: { type: DataTypes.STRING, allowNull: false },
  phone: { type: DataTypes.STRING, allowNull: true },
  profile_picture: { type: DataTypes.TEXT, allowNull: true },
  role_id: { type: DataTypes.INTEGER, allowNull: false },
  barangay_id: { type: DataTypes.INTEGER, allowNull: true },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
  is_approved: { type: DataTypes.BOOLEAN, defaultValue: false },
  approved_by: { type: DataTypes.INTEGER, allowNull: true },
  approved_at: { type: DataTypes.DATE, allowNull: true },
});
