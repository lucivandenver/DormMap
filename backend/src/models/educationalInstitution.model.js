export const EducationalInstitutionModel = (sequelize, DataTypes) => sequelize.define('educational_institution', {
  name: { type: DataTypes.STRING, allowNull: false },
  institution_type: { type: DataTypes.STRING, allowNull: false },
  address: { type: DataTypes.TEXT, allowNull: true },
  latitude: { type: DataTypes.STRING, allowNull: false },
  longitude: { type: DataTypes.STRING, allowNull: false },
  barangay_id: { type: DataTypes.INTEGER, allowNull: true },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
});
