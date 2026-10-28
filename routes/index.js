
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
    
import express from "express";
import { homePage, aboutPage, boardingHousesApi, institutionsApi, landingDataApi, eligibleBarangaysApi, mapPlaceApi } from "../controllers/homeController.js";
import authRoutes from "./authRoutes.js";
import adminRoutes from './adminRoutes.js';
import barangayDashboardRoutes from './barangayDashboardRoutes.js';
import ownerDashboardRoutes from './ownerDashboardRoutes.js';
import tenantDashboardRoutes from './tenantDashboardRoutes.js';
import paymentRoutes from './paymentRoutes.js';
import dormigoRoutes from './dormigoRoutes.js';
import { renderProcessingPage, renderSuccessPage, renderFailurePage, renderGcashPortal } from '../controllers/paymentController.js';

const router = express.Router();
router.get("/", homePage);
router.get("/about", aboutPage);
router.get("/api/boarding-houses", boardingHousesApi);
router.get("/api/institutions", institutionsApi);
router.get('/api/landing-data', landingDataApi);
router.get('/api/eligible-barangays', eligibleBarangaysApi);
router.get('/api/map-place', mapPlaceApi);
router.use('/api/dormigo', dormigoRoutes);
router.use('/admin', adminRoutes);
router.use('/barangay-dashboard', barangayDashboardRoutes);
router.use('/owner-dashboard', ownerDashboardRoutes);
router.use('/tenant-dashboard', tenantDashboardRoutes);
router.use('/api/payments', paymentRoutes);

// Shortcut result pages
router.get('/payments/processing', renderProcessingPage);
router.get('/payments/success', renderSuccessPage);
router.get('/payments/failure', renderFailurePage);
router.get('/payments/gcash-portal', renderGcashPortal);

router.use("/", authRoutes);

export default router;
