export const PermitModel = (sequelize, DataTypes) => sequelize.define('permit', {
  boarding_house_id: { type: DataTypes.INTEGER, allowNull: false },
  permit_number: { type: DataTypes.STRING, allowNull: false },
  issue_date: { type: DataTypes.DATE, allowNull: false },
  expiration_date: { type: DataTypes.DATE, allowNull: false },
  document_url: { type: DataTypes.TEXT, allowNull: true },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
  renewal_requested_at: { type: DataTypes.DATE, allowNull: true },
});
