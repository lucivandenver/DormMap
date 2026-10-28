export const TenantModel = (sequelize, DataTypes) => sequelize.define('tenant', {
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  boarding_house_id: { type: DataTypes.INTEGER, allowNull: false },
  room_id: { type: DataTypes.INTEGER, allowNull: true },
  move_in_date: { type: DataTypes.DATE, allowNull: true },
  move_out_date: { type: DataTypes.DATE, allowNull: true },
  monthly_rent: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
  balance: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
  emergency_contact: { type: DataTypes.JSON, allowNull: true },
  contract_documents: { type: DataTypes.JSON, allowNull: true },
});
