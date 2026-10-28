
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
import { Barangay } from '../models/adminModels.js';
import { publicDormListings, landingSnapshot } from '../services/landingService.js';
import { activeBarangayWhere } from '../services/registrationPolicy.js';
import { lookupPlace, storedPlace } from '../services/mapPlaceService.js';

export const homePage = (req, res) => {
  res.render("home", {
    title: "DormMap",
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
  try { res.json(await publicDormListings()); }
  catch (error) { console.error(error); res.status(503).json({ error: 'Unable to load boarding houses. Please retry.' }); }
};

export const landingDataApi = async (req, res) => {
  try { res.set('Cache-Control', 'no-store').json(await landingSnapshot()); }
  catch (error) { console.error(error); res.status(503).json({ error: 'Live data is temporarily unavailable.' }); }
};

export const eligibleBarangaysApi = async (req, res) => {
  try {
    const users = await User.findAll({ where: activeBarangayWhere, attributes: ['barangay'] });
    res.json([...new Set(users.map(user => user.barangay).filter(Boolean))].sort());
  } catch (error) { res.status(503).json({ error: 'Unable to check available barangays.' }); }
};

export const mapPlaceApi = async (req, res) => {
  try {
    const kind = req.query.kind;
    const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    if (!['institution', 'barangay'].includes(kind) || !name || name.length > 150) return res.status(400).json({ error: 'Choose a barangay or institution.' });
    const Model = kind === 'institution' ? EducationalInstitution : Barangay;
    const record = await Model.findOne({ where: { name, isActive: true } });
    const place = storedPlace(record) || await lookupPlace(name, kind);
    if (!place) return res.status(404).json({ error: 'No verified map location found. BPLO can add the correct coordinates in Settings.' });
    res.json(place);
  } catch (error) { console.error('Place search failed:', error.message); res.status(503).json({ error: 'Location search is temporarily unavailable. Try again later.' }); }
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
