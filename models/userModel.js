

      /*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */
import { DataTypes, Op } from "sequelize";
import { sequelize } from "./db.js";

export { Op };
export const User = sequelize.define("User", {
  fullName: { type: DataTypes.STRING, allowNull: false, field: 'name' },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  password: { type: DataTypes.STRING, allowNull: false },
  accountType: { type: DataTypes.STRING, allowNull: false },
  profilePicture: { type: DataTypes.TEXT, allowNull: true },
  barangay: { type: DataTypes.STRING, allowNull: true },
  positionTitle: { type: DataTypes.STRING, allowNull: true },
  description: { type: DataTypes.TEXT, allowNull: true },
  boardingHouseName: { type: DataTypes.STRING, allowNull: true },
  boardingHouseAddress: { type: DataTypes.TEXT, allowNull: true },
  boardingHousePicture: { type: DataTypes.TEXT, allowNull: true },
  roomsAvailable: { type: DataTypes.INTEGER, allowNull: true },
  mapPin: { type: DataTypes.TEXT, allowNull: true },
  boardingHouseLatitude: { type: DataTypes.STRING, allowNull: true },
  boardingHouseLongitude: { type: DataTypes.STRING, allowNull: true },
  selectedBoardingHouse: { type: DataTypes.STRING, allowNull: true },
  validIdPicture: { type: DataTypes.TEXT, allowNull: true },
  paymentMethods: { type: DataTypes.TEXT, allowNull: true },
  gcashNumber: { type: DataTypes.STRING, allowNull: true },
  gcashName: { type: DataTypes.STRING, allowNull: true },
  gcashQrCode: { type: DataTypes.TEXT, allowNull: true },
  businessPermit: { type: DataTypes.TEXT, allowNull: true },
  supportingDocuments: { type: DataTypes.TEXT, allowNull: true },
  emailVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  verificationToken: { type: DataTypes.STRING, allowNull: true },
  googleId: { type: DataTypes.STRING, allowNull: true },
  oauthProvider: { type: DataTypes.STRING, allowNull: true },
  contactNumber: { type: DataTypes.STRING, allowNull: true },
  gender: { type: DataTypes.STRING, allowNull: true },
  budgetRange: { type: DataTypes.STRING, allowNull: true },
  preferredLocation: { type: DataTypes.STRING, allowNull: true },

  barangayClearance: { type: DataTypes.TEXT, allowNull: true },
  proofOfOwnership: { type: DataTypes.TEXT, allowNull: true },
  rentalPermit: { type: DataTypes.TEXT, allowNull: true },
  occupiedRooms: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
  roomTypes: { type: DataTypes.TEXT, allowNull: true },
  houseRules: { type: DataTypes.TEXT, allowNull: true },
  amenities: { type: DataTypes.TEXT, allowNull: true },
  notes: { type: DataTypes.TEXT, allowNull: true },
  rentalPriceMin: { type: DataTypes.FLOAT, allowNull: true },
  rentalPriceMax: { type: DataTypes.FLOAT, allowNull: true },
  operatingHours: { type: DataTypes.STRING, allowNull: true },
  galleryImages: { type: DataTypes.TEXT, allowNull: true },
  publicMapUnregistered: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  publicMapPublished: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  applicationStatus: { type: DataTypes.STRING, allowNull: false, defaultValue: 'approved' },
  applicationReviewedAt: { type: DataTypes.DATE, allowNull: true },
  applicationReviewNote: { type: DataTypes.TEXT, allowNull: true },
  isSuspended: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  isArchived: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  resetPasswordToken: { type: DataTypes.STRING, allowNull: true },
  resetPasswordExpires: { type: DataTypes.DATE, allowNull: true }
});
export { sequelize }; 
