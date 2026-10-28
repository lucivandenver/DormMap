export const RoomModel = (sequelize, DataTypes) => sequelize.define('room', {
  boarding_house_id: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  room_type: { type: DataTypes.STRING, allowNull: false },
  capacity: { type: DataTypes.INTEGER, allowNull: false },
  available_slots: { type: DataTypes.INTEGER, allowNull: false },
  rental_rate: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  dimensions: { type: DataTypes.STRING, allowNull: true },
  gender_preference: { type: DataTypes.STRING, allowNull: true },
  furnished: { type: DataTypes.BOOLEAN, defaultValue: false },
  photos: { type: DataTypes.JSON, allowNull: true },
  amenities: { type: DataTypes.JSON, allowNull: true },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'available' },
});
