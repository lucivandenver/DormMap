
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
    IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */
import { Op } from "sequelize";
import { User } from "../models/userModel.js";
import { EducationalInstitution } from "../models/adminModels.js";
import { BoardingHouse, OwnerGallery, OwnerRoom } from "../models/ownerModels.js";

export const homePage = (req, res) => {
  res.render("home", {
    title: "DormMap | Official BPLO Dormitory Finder",
    authMode: "login",
    authOpen: false,
    authAccountType: "tenant",
    authError: "",
    authSuccess: "",
    authValues: {},
    currentUser: req.session.userName || null,
    currentRole: req.session.accountType || null,
  });
};

export const aboutPage = (req, res) => {
  res.render("about", {
    title: "About DormMap | Municipality of Bongabong Official BPLO Portal",
    currentUser: req.session.userName || null,
    currentRole: req.session.accountType || null,
  });
};

export const boardingHousesApi = async (req, res) => {
  try {
    const owners = await User.findAll({
      where: {
        accountType: "boarding_house_owner",
        applicationStatus: { [Op.in]: ["approved", "approved_barangay"] },
        isSuspended: false,
        isArchived: false,
      },
      attributes: [
        "id", "fullName", "email", "boardingHouseName", "boardingHouseAddress",
        "boardingHousePicture", "profilePicture", "boardingHouseLatitude",
        "boardingHouseLongitude", "mapPin", "roomsAvailable", "roomTypes",
        "paymentMethods", "contactNumber", "barangay", "houseRules", "amenities",
        "notes", "rentalPriceMin", "rentalPriceMax", "galleryImages",
      ],
    });

    const ownerIds = owners.map((o) => o.id);

    const [allBhRecords, galleryItems, rooms] = await Promise.all([
      BoardingHouse.findAll({ where: { ownerId: { [Op.in]: ownerIds } } }),
      OwnerGallery.findAll({ where: { ownerId: { [Op.in]: ownerIds } }, order: [["sortOrder", "ASC"]] }),
      OwnerRoom.findAll({ where: { ownerId: { [Op.in]: ownerIds } } }),
    ]);

    // Separate photos strictly by boardingHouseId; keep legacy photos (boardingHouseId is null) mapped to ownerId
    const bhGalleryMap = {};
    const legacyOwnerGallery = {};
    for (const g of galleryItems) {
      if (g.imageUrl) {
        if (g.boardingHouseId) {
          if (!bhGalleryMap[g.boardingHouseId]) bhGalleryMap[g.boardingHouseId] = [];
          if (!bhGalleryMap[g.boardingHouseId].includes(g.imageUrl)) {
            bhGalleryMap[g.boardingHouseId].push(g.imageUrl);
          }
        } else {
          if (!legacyOwnerGallery[g.ownerId]) legacyOwnerGallery[g.ownerId] = [];
          if (!legacyOwnerGallery[g.ownerId].includes(g.imageUrl)) {
            legacyOwnerGallery[g.ownerId].push(g.imageUrl);
          }
        }
      }
    }

    const parseList = (value) => {
      if (!value) return [];
      try {
        const list = JSON.parse(value);
        return Array.isArray(list) ? list : [];
      } catch {
        return [String(value)];
      }
    };

    const listings = [];

    for (const owner of owners) {
      const ownerPlain = owner.get({ plain: true });
      const ownerBhList = allBhRecords.filter(b => b.ownerId === owner.id);

      // If owner has explicitly defined BoardingHouse records, build a listing for each one
      if (ownerBhList.length > 0) {
        for (const bh of ownerBhList) {
          const bhRooms = rooms.filter(r => r.ownerId === owner.id && (r.boardingHouseId === bh.id || (!r.boardingHouseId && bh.isPrimary)));
          const availableRoomsCount = bhRooms.filter(r => r.status === 'available').length;

          let latitude = Number(String(bh.latitude ?? '').trim());
          let longitude = Number(String(bh.longitude ?? '').trim());

          if ((!Number.isFinite(latitude) || !Number.isFinite(longitude)) && bh.mapPin) {
            const match = bh.mapPin.match(/Lat\s*([0-9.-]+),\s*Lon\s*([0-9.-]+)/i);
            if (match) { latitude = Number(match[1]); longitude = Number(match[2]); }
          }
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            latitude = 12.7192; longitude = 121.4719;
          }

          // Build photos STRICTLY for this boarding house
          const bhPhotos = bhGalleryMap[bh.id] || [];
          const images = [];

          if (bh.picture) {
            images.push(bh.picture);
          }

          bhPhotos.forEach(img => {
            if (!images.includes(img)) images.push(img);
          });

          // Fallback ONLY for the primary house if it has no photos of its own
          if (images.length === 0 && bh.isPrimary) {
            if (ownerPlain.boardingHousePicture) images.push(ownerPlain.boardingHousePicture);
            if (legacyOwnerGallery[owner.id]) {
              legacyOwnerGallery[owner.id].forEach(img => {
                if (!images.includes(img)) images.push(img);
              });
            }
          }

          // Determine the cover picture for this specific boarding house
          const bhPicture = bh.picture || (bhPhotos[0] || (bh.isPrimary ? (ownerPlain.boardingHousePicture || '') : ''));

          listings.push({
            ...ownerPlain,
            id: owner.id,
            bhId: bh.id,
            boardingHouseName: bh.name,
            boardingHouseAddress: bh.address || ownerPlain.boardingHouseAddress,
            barangay: bh.barangay || ownerPlain.barangay,
            boardingHousePicture: bhPicture,
            description: bh.description || ownerPlain.description || '',
            amenities: bh.amenities || ownerPlain.amenities || '',
            houseRules: bh.houseRules || ownerPlain.houseRules || '',
            boardingHouseLatitude: String(latitude),
            boardingHouseLongitude: String(longitude),
            latitude,
            longitude,
            roomsAvailable: availableRoomsCount || bhRooms.length || ownerPlain.roomsAvailable || 0,
            galleryImages: images,
            roomTypes: parseList(ownerPlain.roomTypes),
            paymentMethods: parseList(ownerPlain.paymentMethods),
          });
        }
      } else {
        // Fallback to primary User listing
        let latitude = Number(String(ownerPlain.boardingHouseLatitude ?? '').trim());
        let longitude = Number(String(ownerPlain.boardingHouseLongitude ?? '').trim());
        if ((!Number.isFinite(latitude) || !Number.isFinite(longitude)) && ownerPlain.mapPin) {
          const match = ownerPlain.mapPin.match(/Lat\s*([0-9.-]+),\s*Lon\s*([0-9.-]+)/i);
          if (match) { latitude = Number(match[1]); longitude = Number(match[2]); }
        }
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          latitude = 12.7192; longitude = 121.4719;
        }

        const images = [];
        if (ownerPlain.boardingHousePicture) images.push(ownerPlain.boardingHousePicture);
        if (legacyOwnerGallery[owner.id]) {
          legacyOwnerGallery[owner.id].forEach(img => { if (!images.includes(img)) images.push(img); });
        }

        listings.push({
          ...ownerPlain,
          latitude,
          longitude,
          boardingHousePicture: ownerPlain.boardingHousePicture || (images[0] || ''),
          galleryImages: images,
          roomTypes: parseList(ownerPlain.roomTypes),
          paymentMethods: parseList(ownerPlain.paymentMethods),
        });
      }
    }

    res.json(listings);
  } catch (error) {
    console.error("Boarding houses API error:", error);
    res.status(500).json({ error: "Unable to load boarding houses" });
  }
};

export const institutionsApi = async (req, res) => {
  try {
    const list = await EducationalInstitution.findAll({
      where: { isActive: true },
      order: [['name', 'ASC']],
    });
    res.json(list);
  } catch (error) {
    console.error("Institutions API error:", error);
    res.status(500).json({ error: "Unable to load institutions" });
  }
};
