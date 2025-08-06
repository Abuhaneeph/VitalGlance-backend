const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const app = express();
require('dotenv').config();

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Data storage - In production, use a proper database
let sensorData = [];
const DATA_FILE = path.join(__dirname, 'sensor_data.json');

// Function to get the last stored values for a device to ensure variation
const getLastStoredValues = (deviceId) => {
  const deviceRecords = sensorData
    .filter(record => record.deviceId === deviceId)
    .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
  
  if (deviceRecords.length > 0) {
    const lastRecord = deviceRecords[0];
    return {
      heartRate: lastRecord.heartRate || 72,
      spo2: lastRecord.spo2 || 98,
      temperature: lastRecord.temperature || 36.5,
      glucose: lastRecord.lastGlucose || 85
    };
  }
  
  // Default values for first reading
  return {
    heartRate: 72,
    spo2: 98,
    temperature: 36.5,
    glucose: 85
  };
};

// Function to apply controlled variation to ensure values always change
const applyControlledVariation = (currentValue, lastValue, range) => {
  const { min, max, minChange } = range;
  
  // Ensure minimum change from last value
  let newValue;
  const changeDirection = Math.random() > 0.5 ? 1 : -1;
  const minVariation = minChange || 0.1;
  
  // Apply minimum variation
  newValue = lastValue + (changeDirection * minVariation);
  
  // Add additional random variation (up to 0.5 more)
  const additionalVariation = (Math.random() - 0.5) * 1.0;
  newValue += additionalVariation;
  
  // Ensure within healthy bounds
  newValue = Math.max(min, Math.min(max, newValue));
  
  // If we're too close to the last value, force a bigger change
  if (Math.abs(newValue - lastValue) < minVariation) {
    const forcedChange = minVariation * (Math.random() > 0.5 ? 1 : -1);
    newValue = lastValue + forcedChange;
    newValue = Math.max(min, Math.min(max, newValue));
  }
  
  return newValue;
};

// Function to generate realistic healthy sensor values with guaranteed variation
const generateHealthyValues = (originalData) => {
  const deviceId = originalData.deviceId;
  const lastValues = getLastStoredValues(deviceId);
  
  // Get current time for natural variation
  const timeOfDay = new Date().getHours();
  const isRestingTime = timeOfDay >= 22 || timeOfDay <= 6; // 10 PM to 6 AM
  const isActiveTime = timeOfDay >= 9 && timeOfDay <= 18; // 9 AM to 6 PM
  
  // Generate healthy heart rate with guaranteed variation
  let heartRateRange = { min: 60, max: 95, minChange: 1 };
  if (isRestingTime) {
    heartRateRange = { min: 55, max: 75, minChange: 1 };
  } else if (isActiveTime) {
    heartRateRange = { min: 65, max: 90, minChange: 1 };
  }
  
  const healthyHeartRate = Math.round(applyControlledVariation(
    lastValues.heartRate, 
    lastValues.heartRate, 
    heartRateRange
  ));
  
  // Generate healthy SpO2 with guaranteed variation (95-100%)
  const healthySpO2 = Math.round(applyControlledVariation(
    lastValues.spo2,
    lastValues.spo2,
    { min: 95, max: 100, minChange: 0.5 }
  ));
  
  // Generate healthy body temperature with guaranteed variation (36.1-37.2°C)
  let tempRange = { min: 36.1, max: 37.2, minChange: 0.1 };
  
  // Add slight variation based on time of day
  if (timeOfDay >= 6 && timeOfDay <= 10) {
    tempRange = { min: 36.0, max: 36.8, minChange: 0.1 }; // Lower in morning
  } else if (timeOfDay >= 16 && timeOfDay <= 20) {
    tempRange = { min: 36.5, max: 37.2, minChange: 0.1 }; // Higher in evening
  }
  
  const healthyTemp = parseFloat(applyControlledVariation(
    lastValues.temperature,
    lastValues.temperature,
    tempRange
  ).toFixed(1));
  
  // Generate realistic raw sensor values with variation
  const lastRed = originalData.red || 80000;
  const lastIR = originalData.ir || 85000;
  
  const healthyRed = Math.round(applyControlledVariation(
    lastRed,
    lastRed,
    { min: 75000, max: 120000, minChange: 1000 }
  ));
  
  const healthyIR = Math.round(applyControlledVariation(
    lastIR,
    lastIR,
    { min: 80000, max: 120000, minChange: 1000 }
  ));
  
  // Calculate heart rate average (slightly smoothed)
  const heartRateAvg = originalData.heartRateAvg ? 
    Math.round((healthyHeartRate + originalData.heartRateAvg) / 2) : 
    healthyHeartRate;
  
  return {
    ...originalData,
    heartRate: healthyHeartRate,
    heartRateAvg: heartRateAvg,
    heartRateValid: true,
    spo2: healthySpO2,
    spo2Valid: true,
    temperature: healthyTemp,
    red: healthyRed,
    ir: healthyIR,
    fingerDetected: true,
    simulatedHealthy: true,
    lastValues: lastValues, // Store for reference
    originalValues: {
      heartRate: originalData.heartRate,
      spo2: originalData.spo2,
      temperature: originalData.temperature,
      red: originalData.red,
      ir: originalData.ir
    }
  };
};

// Function to simulate healthy glucose levels with medical standards and guaranteed variation
const simulateHealthyGlucose = (heartRate, heartRateAvg, spo2, temperature, deviceId) => {
  const lastValues = getLastStoredValues(deviceId);
  
  // Get current time for natural variation
  const timeOfDay = new Date().getHours();
  const isPostMealTime = (timeOfDay >= 8 && timeOfDay <= 10) || 
                        (timeOfDay >= 12 && timeOfDay <= 14) || 
                        (timeOfDay >= 18 && timeOfDay <= 20);
  const isFastingTime = timeOfDay >= 22 || timeOfDay <= 7;
  
  // Medical standard ranges for glucose
  let glucoseRange;
  if (isFastingTime) {
    // Normal Fasting Blood sugar: 70-99 mg/dL (keeping it in normal range)
    glucoseRange = { min: 75, max: 95, minChange: 0.5 };
  } else if (isPostMealTime) {
    // Post-meal can be slightly higher but still normal
    glucoseRange = { min: 80, max: 99, minChange: 0.5 };
  } else {
    // Regular daytime glucose - keep in normal fasting range
    glucoseRange = { min: 75, max: 99, minChange: 0.5 };
  }
  
  // Generate base glucose with guaranteed variation from last reading
  let baseGlucose = applyControlledVariation(
    lastValues.glucose,
    lastValues.glucose,
    glucoseRange
  );
  
  // Add small variations based on vital signs (minimal correlation)
  let variation = 0;
  
  // Heart rate influence (minimal, within normal range)
  if (heartRate > 85) {
    variation += Math.random() * 2; // Slightly higher glucose with elevated HR
  } else if (heartRate < 65) {
    variation -= Math.random() * 2; // Slightly lower glucose with low HR
  }
  
  // Temperature influence (minimal, within normal range)
  if (temperature > 37.0) {
    variation += Math.random() * 1.5;
  } else if (temperature < 36.5) {
    variation -= Math.random() * 1;
  }
  
  // SpO2 influence (minimal, within normal range)
  if (spo2 < 97) {
    variation += Math.random() * 1;
  }
  
  // Apply variation but ensure we stay in NORMAL range (70-99 mg/dL)
  const finalGlucose = baseGlucose + variation;
  
  // STRICTLY enforce normal fasting glucose range (70-99 mg/dL)
  const clampedGlucose = Math.max(70, Math.min(99, finalGlucose));
  
  return parseFloat(clampedGlucose.toFixed(1));
};

// Function to interpret glucose levels using medical standards
const interpretGlucose = (glucoseLevel) => {
  if (glucoseLevel < 70) {
    return { category: 'Low (Hypoglycemia)', status: 'warning', message: 'Below normal - consult healthcare provider' };
  } else if (glucoseLevel >= 70 && glucoseLevel <= 99) {
    return { category: 'Normal', status: 'good', message: 'Normal fasting glucose level' };
  } else if (glucoseLevel >= 100 && glucoseLevel <= 125) {
    return { category: 'Prediabetes', status: 'caution', message: 'Prediabetic range - monitor closely' };
  } else if (glucoseLevel >= 126) {
    return { category: 'Diabetes', status: 'warning', message: 'Diabetic range - consult healthcare provider immediately' };
  }
};

// Load existing data on startup
const loadData = () => {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      sensorData = JSON.parse(data);
      console.log(`Loaded ${sensorData.length} existing records`);
    }
  } catch (error) {
    console.error('Error loading data:', error);
    sensorData = [];
  }
};

// Save data to file
const saveData = () => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(sensorData, null, 2));
  } catch (error) {
    console.error('Error saving data:', error);
  }
};

// Initialize data
loadData();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    totalRecords: sensorData.length,
    uptime: process.uptime(),
    glucoseStandards: 'Medical Standard - Normal: 70-99mg/dL, Prediabetes: 100-125mg/dL, Diabetes: ≥126mg/dL',
    variationEnabled: true,
    healthySimulation: true
  });
});

// POST endpoint to receive sensor data (UPDATED with guaranteed variation)
app.post('/api/sensor-data', (req, res) => {
  try {
    const originalData = req.body;
    
    // Validate required fields
    const requiredFields = ['deviceId', 'timestamp'];
    const missingFields = requiredFields.filter(field => !(field in originalData));
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        missingFields: missingFields
      });
    }

    // Generate healthy values with guaranteed variation
    const healthyData = generateHealthyValues(originalData);

    // Add server timestamp and unique ID
    const record = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      receivedAt: new Date().toISOString(),
      ...healthyData
    };

    // Add to array
    sensorData.push(record);

    // Keep only last 10000 records to prevent memory issues
    if (sensorData.length > 10000) {
      sensorData = sensorData.slice(-10000);
    }

    // Save to file every 10 records
    if (sensorData.length % 10 === 0) {
      saveData();
    }

    console.log(`Received data from ${healthyData.deviceId} - HEALTHY SIMULATION WITH VARIATION:`);
    console.log(`  HR: ${healthyData.heartRate} BPM (prev: ${healthyData.lastValues.heartRate}) Δ${(healthyData.heartRate - healthyData.lastValues.heartRate).toFixed(1)}`);
    console.log(`  SPO2: ${healthyData.spo2}% (prev: ${healthyData.lastValues.spo2}) Δ${(healthyData.spo2 - healthyData.lastValues.spo2).toFixed(1)}`);
    console.log(`  Temp: ${healthyData.temperature}°C (prev: ${healthyData.lastValues.temperature}) Δ${(healthyData.temperature - healthyData.lastValues.temperature).toFixed(1)}`);

    res.status(201).json({
      success: true,
      message: 'Data received and converted to healthy values with guaranteed variation',
      recordId: record.id,
      totalRecords: sensorData.length,
      simulatedHealthy: true,
      variationApplied: true,
      healthyValues: {
        heartRate: healthyData.heartRate,
        spo2: healthyData.spo2,
        temperature: healthyData.temperature,
        red: healthyData.red,
        ir: healthyData.ir
      },
      previousValues: healthyData.lastValues,
      variations: {
        heartRate: +(healthyData.heartRate - healthyData.lastValues.heartRate).toFixed(1),
        spo2: +(healthyData.spo2 - healthyData.lastValues.spo2).toFixed(1),
        temperature: +(healthyData.temperature - healthyData.lastValues.temperature).toFixed(1)
      },
      originalValues: healthyData.originalValues
    });

  } catch (error) {
    console.error('Error processing sensor data:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// POST endpoint to predict glucose level (UPDATED with medical standards and variation)
app.post('/api/predict-glucose', async (req, res) => {
  try {
    const { heartRate, heartRateAvg, spo2, temperature, deviceId } = req.body;
    
    // Validate required fields for prediction
    const requiredFields = ['heartRate', 'spo2', 'temperature'];
    const missingFields = requiredFields.filter(field => !(field in req.body));
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        error: 'Missing required fields for prediction',
        missingFields: missingFields,
        requiredFields: ['heartRate', 'heartRateAvg', 'spo2', 'temperature', 'deviceId']
      });
    }

    // Use heartRateAvg if provided, otherwise use heartRate
    const avgHeartRate = heartRateAvg !== undefined ? heartRateAvg : heartRate;

    // Validate input ranges
    if (heartRate < 0 || heartRate > 200) {
      return res.status(400).json({
        error: 'Invalid heart rate',
        message: 'Heart rate should be between 0-200 BPM'
      });
    }
    
    if (spo2 < 70 || spo2 > 100) {
      return res.status(400).json({
        error: 'Invalid SpO2',
        message: 'SpO2 should be between 70-100%'
      });
    }
    
    if (temperature < 30 || temperature > 45) {
      return res.status(400).json({
        error: 'Invalid temperature',
        message: 'Temperature should be between 30-45°C'
      });
    }

    // Get last glucose value for this device to ensure variation
    const lastValues = getLastStoredValues(deviceId || 'unknown');
    
    // Simulate healthy glucose level with medical standards and guaranteed variation
    const predictedGlucose = simulateHealthyGlucose(heartRate, avgHeartRate, spo2, temperature, deviceId || 'unknown');
    const interpretation = interpretGlucose(predictedGlucose);

    // Store the glucose value for future variation calculations
    const predictionRecord = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      deviceId: deviceId || 'unknown',
      lastGlucose: predictedGlucose, // Store for next calculation
      input: {
        heartRate,
        heartRateAvg: avgHeartRate,
        spo2,
        temperature
      },
      prediction: {
        glucoseLevel: predictedGlucose,
        category: interpretation.category,
        status: interpretation.status,
        message: interpretation.message
      },
      previousGlucose: lastValues.glucose,
      glucoseVariation: +(predictedGlucose - lastValues.glucose).toFixed(1),
      medicalStandards: {
        normal: '70-99 mg/dL',
        prediabetes: '100-125 mg/dL',
        diabetes: '≥126 mg/dL'
      },
      simulatedGlucose: true
    };

    // Add this record to sensorData to maintain glucose history
    sensorData.push(predictionRecord);

    console.log(`Glucose simulation for ${deviceId || 'unknown'}: ${predictedGlucose} mg/dL (${interpretation.category}) - Previous: ${lastValues.glucose} mg/dL, Variation: ${(predictedGlucose - lastValues.glucose).toFixed(1)}`);

    res.json({
      success: true,
      timestamp: predictionRecord.timestamp,
      deviceId: predictionRecord.deviceId,
      input: predictionRecord.input,
      prediction: predictionRecord.prediction,
      variationInfo: {
        previousGlucose: lastValues.glucose,
        currentGlucose: predictedGlucose,
        variation: predictionRecord.glucoseVariation
      },
      medicalStandards: predictionRecord.medicalStandards,
      simulatedGlucose: true,
      disclaimers: [
        'This glucose value is simulated using medical standards for demonstration',
        'Normal fasting glucose: 70-99 mg/dL',
        'Prediabetes: 100-125 mg/dL',
        'Diabetes: ≥126 mg/dL',
        'Values are guaranteed to vary from previous readings',
        'Not a substitute for professional medical diagnosis',
        'Consult healthcare provider for medical decisions'
      ]
    });

  } catch (error) {
    console.error('Error simulating glucose:', error);
    res.status(500).json({
      error: 'Simulation failed',
      message: error.message
    });
  }
});

// Comprehensive health data endpoint - UPDATED with medical standards
app.get('/api/health-data/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { includeHistory = false, historyLimit = 10 } = req.query;
    
    // Find latest valid reading for the device
    const latestReading = sensorData
      .filter(record => 
        record.deviceId === deviceId && 
        record.heartRate !== undefined && 
        record.spo2 !== undefined && 
        record.temperature !== undefined
      )
      .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))[0];

    if (!latestReading) {
      return res.status(404).json({
        error: 'No sensor data found',
        message: `No valid sensor readings found for device ${deviceId}`,
        deviceId: deviceId
      });
    }

    // Extract biometric data
    const { heartRate, heartRateAvg, spo2, temperature, red, ir, fingerDetected } = latestReading;
    const avgHeartRate = heartRateAvg !== undefined ? heartRateAvg : heartRate;

    // Interpret vital signs
    const interpretVitals = (hr, spo2, temp) => {
      const interpretations = {};
      
      // Heart Rate interpretation
      if (hr === 0) {
        interpretations.heartRate = { status: 'error', message: 'Sensor not detecting heartbeat', category: 'No Reading' };
      } else if (hr < 60) {
        interpretations.heartRate = { status: 'caution', message: 'Below normal range (bradycardia)', category: 'Low' };
      } else if (hr >= 60 && hr <= 100) {
        interpretations.heartRate = { status: 'good', message: 'Normal heart rate', category: 'Normal' };
      } else if (hr > 100 && hr <= 120) {
        interpretations.heartRate = { status: 'caution', message: 'Slightly elevated', category: 'Elevated' };
      } else {
        interpretations.heartRate = { status: 'warning', message: 'High heart rate (tachycardia)', category: 'High' };
      }

      // SpO2 interpretation
      if (spo2 >= 95) {
        interpretations.spo2 = { status: 'good', message: 'Normal oxygen saturation', category: 'Normal' };
      } else if (spo2 >= 90 && spo2 < 95) {
        interpretations.spo2 = { status: 'caution', message: 'Below normal range', category: 'Low Normal' };
      } else {
        interpretations.spo2 = { status: 'warning', message: 'Low oxygen saturation - seek medical attention', category: 'Low' };
      }

      // Temperature interpretation (Celsius)
      if (temp < 35.0) {
        interpretations.temperature = { status: 'warning', message: 'Below normal body temperature', category: 'Hypothermia' };
      } else if (temp >= 35.0 && temp <= 37.2) {
        interpretations.temperature = { status: 'good', message: 'Normal body temperature', category: 'Normal' };
      } else if (temp > 37.2 && temp <= 38.0) {
        interpretations.temperature = { status: 'caution', message: 'Slightly elevated temperature', category: 'Mild Fever' };
      } else if (temp > 38.0 && temp <= 39.0) {
        interpretations.temperature = { status: 'warning', message: 'Moderate fever', category: 'Fever' };
      } else {
        interpretations.temperature = { status: 'warning', message: 'High fever - seek medical attention', category: 'High Fever' };
      }

      return interpretations;
    };

    const vitalInterpretations = interpretVitals(heartRate, spo2, temperature);

    // Simulate glucose level with medical standards
    const predictedGlucose = simulateHealthyGlucose(heartRate, avgHeartRate, spo2, temperature, deviceId);
    const glucoseInterpretation = interpretGlucose(predictedGlucose);
    
    const glucosePrediction = {
      value: predictedGlucose,
      unit: 'mg/dL',
      category: glucoseInterpretation.category,
      status: glucoseInterpretation.status,
      message: glucoseInterpretation.message,
      medicalStandards: {
        normal: '70-99 mg/dL',
        prediabetes: '100-125 mg/dL',
        diabetes: '≥126 mg/dL'
      },
      confidence: 'Simulated - Medical Standards',
      simulatedGlucose: true
    };

    // Calculate overall health score
    const calculateHealthScore = (vitals, glucose) => {
      let score = 100;
      let factors = [];

      // Deduct points based on vital sign status
      Object.entries(vitals).forEach(([vital, interpretation]) => {
        if (interpretation.status === 'warning') {
          score -= 20;
          factors.push(`${vital}: ${interpretation.message}`);
        } else if (interpretation.status === 'caution') {
          score -= 10;
          factors.push(`${vital}: ${interpretation.message}`);
        } else if (interpretation.status === 'error') {
          score -= 15;
          factors.push(`${vital}: ${interpretation.message}`);
        }
      });

      // Consider glucose with medical standards
      if (glucose && glucose.status === 'warning') {
        score -= 15;
        factors.push(`Glucose: ${glucose.message}`);
      } else if (glucose && glucose.status === 'caution') {
        score -= 8;
        factors.push(`Glucose: ${glucose.message}`);
      }

      score = Math.max(0, score);

      let healthStatus = 'Excellent';
      if (score < 60) healthStatus = 'Poor';
      else if (score < 75) healthStatus = 'Fair';
      else if (score < 90) healthStatus = 'Good';

      return { score, status: healthStatus, factors };
    };

    const healthScore = calculateHealthScore(vitalInterpretations, glucosePrediction);

    // Get historical data if requested
    let historicalData = null;
    if (includeHistory === 'true') {
      historicalData = sensorData
        .filter(record => record.deviceId === deviceId)
        .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))
        .slice(0, parseInt(historyLimit))
        .map(record => ({
          timestamp: record.receivedAt,
          heartRate: record.heartRate,
          spo2: record.spo2,
          temperature: record.temperature,
          fingerDetected: record.fingerDetected,
          simulatedHealthy: record.simulatedHealthy,
          glucose: record.lastGlucose
        }));
    }

    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      deviceId: deviceId,
      simulatedHealthy: latestReading.simulatedHealthy || false,
      variationEnabled: true,
      sensorData: {
        timestamp: latestReading.receivedAt,
        raw: {
          red: red,
          ir: ir,
          fingerDetected: fingerDetected
        }
      },
      vitals: {
        heartRate: {
          value: heartRate,
          average: avgHeartRate,
          unit: 'BPM',
          ...vitalInterpretations.heartRate
        },
        spo2: {
          value: spo2,
          unit: '%',
          ...vitalInterpretations.spo2
        },
        temperature: {
          value: temperature,
          unit: '°C',
          fahrenheit: Math.round((temperature * 9/5 + 32) * 10) / 10,
          ...vitalInterpretations.temperature
        }
      },
      glucose: glucosePrediction,
      healthScore: healthScore,
      qualityIndicators: {
        sensorContact: fingerDetected ? 'Good' : 'Poor',
        signalQuality: (red > 50000 && ir > 50000) ? 'Good' : 'Poor',
        dataFreshness: Math.round((new Date() - new Date(latestReading.receivedAt)) / 1000) + ' seconds ago'
      }
    };

    // Add historical data if requested
    if (historicalData) {
      response.history = {
        count: historicalData.length,
        data: historicalData
      };
    }

    // Add previous values if available
    if (latestReading.lastValues) {
      response.previousValues = latestReading.lastValues;
      response.variations = {
        heartRate: +(heartRate - latestReading.lastValues.heartRate).toFixed(1),
        spo2: +(spo2 - latestReading.lastValues.spo2).toFixed(1),
        temperature: +(temperature - latestReading.lastValues.temperature).toFixed(1)
      };
    }

    // Add original values if this was simulated
    if (latestReading.originalValues) {
      response.originalValues = latestReading.originalValues;
    }

    // Add medical disclaimers
    response.disclaimers = [
      'This data follows medical standards for glucose ranges',
      'Normal fasting glucose: 70-99 mg/dL, Prediabetes: 100-125 mg/dL, Diabetes: ≥126 mg/dL',
      'Values are guaranteed to vary from previous readings by at least 0.1 units',
      'Glucose and vital signs are predicted for educational purposes only',
      'Consult healthcare provider for medical decisions',
      'Use actual medical devices for real health monitoring'
    ];

    console.log(`Comprehensive health data for ${deviceId}: HR=${heartRate}, SpO2=${spo2}%, Temp=${temperature}°C, Glucose=${glucosePrediction.value}mg/dL (Normal Range)`);

    res.json(response);

  } catch (error) {
    console.error('Error fetching comprehensive health data:', error);
    res.status(500).json({
      error: 'Failed to retrieve health data',
      message: error.message,
      deviceId: req.params.deviceId
    });
  }
});

// GET endpoint to fetch all sensor data
app.get('/api/sensor-data', (req, res) => {
  try {
    const { 
      limit = 100, 
      offset = 0, 
      deviceId, 
      startDate, 
      endDate,
      validOnly = false 
    } = req.query;

    let filteredData = [...sensorData];

    // Filter by device ID
    if (deviceId) {
      filteredData = filteredData.filter(record => record.deviceId === deviceId);
    }

    // Filter by date range
    if (startDate) {
      const start = new Date(startDate);
      filteredData = filteredData.filter(record => new Date(record.receivedAt) >= start);
    }

    if (endDate) {
      const end = new Date(endDate);
      filteredData = filteredData.filter(record => new Date(record.receivedAt) <= end);
    }

    // Filter for valid readings only
    if (validOnly === 'true') {
      filteredData = filteredData.filter(record => 
        record.heartRateValid && 
        record.spo2Valid && 
        record.fingerDetected
      );
    }

    // Sort by timestamp (newest first)
    filteredData.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));

    // Apply pagination
    const startIndex = parseInt(offset);
    const endIndex = startIndex + parseInt(limit);
    const paginatedData = filteredData.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: paginatedData,
      pagination: {
        total: filteredData.length,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: endIndex < filteredData.length
      },
      filters: {
        deviceId: deviceId || null,
        startDate: startDate || null,
        endDate: endDate || null,
        validOnly: validOnly === 'true'
      },
      simulatedHealthy: true,
      medicalStandards: {
        glucose: {
          normal: '70-99 mg/dL',
          prediabetes: '100-125 mg/dL',
          diabetes: '≥126 mg/dL'
        }
      }
    });

  } catch (error) {
    console.error('Error fetching sensor data:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// GET endpoint to fetch data by device ID
app.get('/api/sensor-data/device/:deviceId', (req, res) => {
  try {
    const { deviceId } = req.params;
    const { limit = 50 } = req.query;

    const deviceData = sensorData
      .filter(record => record.deviceId === deviceId)
      .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))
      .slice(0, parseInt(limit));

    // Calculate variations for the latest readings
    const dataWithVariations = deviceData.map((record, index) => {
      if (index < deviceData.length - 1) {
        const prevRecord = deviceData[index + 1];
        return {
          ...record,
          variations: {
            heartRate: record.heartRate && prevRecord.heartRate ? 
              +(record.heartRate - prevRecord.heartRate).toFixed(1) : null,
            spo2: record.spo2 && prevRecord.spo2 ? 
              +(record.spo2 - prevRecord.spo2).toFixed(1) : null,
            temperature: record.temperature && prevRecord.temperature ? 
              +(record.temperature - prevRecord.temperature).toFixed(1) : null,
            glucose: record.lastGlucose && prevRecord.lastGlucose ? 
              +(record.lastGlucose - prevRecord.lastGlucose).toFixed(1) : null
          }
        };
      }
      return record;
    });

    res.json({
      success: true,
      deviceId: deviceId,
      data: dataWithVariations,
      totalRecords: deviceData.length,
      simulatedHealthy: true,
      variationEnabled: true,
      medicalStandards: {
        glucose: {
          normal: '70-99 mg/dL',
          prediabetes: '100-125 mg/dL',
          diabetes: '≥126 mg/dL'
        }
      }
    });

  } catch (error) {
    console.error('Error fetching device data:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// DELETE endpoint to clear data (for testing)
app.delete('/api/sensor-data', (req, res) => {
  try {
    const { deviceId } = req.query;
    
    if (deviceId) {
      const originalLength = sensorData.length;
      sensorData = sensorData.filter(record => record.deviceId !== deviceId);
      const deletedCount = originalLength - sensorData.length;
      
      saveData();
      
      res.json({
        success: true,
        message: `Deleted ${deletedCount} records for device ${deviceId}`,
        remainingRecords: sensorData.length
      });
    } else {
      sensorData = [];
      saveData();
      
      res.json({
        success: true,
        message: 'All sensor data cleared',
        remainingRecords: 0
      });
    }
  } catch (error) {
    console.error('Error clearing data:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Export data as CSV endpoint
app.get('/api/sensor-data/export/csv', (req, res) => {
  try {
    const { deviceId } = req.query;
    
    let dataToExport = sensorData;
    if (deviceId) {
      dataToExport = sensorData.filter(record => record.deviceId === deviceId);
    }

    if (dataToExport.length === 0) {
      return res.status(404).json({
        error: 'No data to export'
      });
    }

    // Generate CSV with additional medical standard info
    const headers = [
      'id', 'deviceId', 'timestamp', 'receivedAt', 'heartRate', 'heartRateAvg', 
      'spo2', 'temperature', 'red', 'ir', 'fingerDetected', 'lastGlucose',
      'simulatedHealthy', 'variationApplied', 'medicalStandardCompliant'
    ].join(',');
    
    const rows = dataToExport.map(record => [
      record.id,
      record.deviceId,
      record.timestamp,
      record.receivedAt,
      record.heartRate,
      record.heartRateAvg,
      record.spo2,
      record.temperature,
      record.red,
      record.ir,
      record.fingerDetected,
      record.lastGlucose || '',
      record.simulatedHealthy || false,
      record.variationApplied || true,
      'Yes - Normal Range (70-99 mg/dL)'
    ].map(val => typeof val === 'string' ? `"${val}"` : val).join(','));
    
    const csv = [headers, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="medical_standard_sensor_data_${Date.now()}.csv"`);
    res.send(csv);

  } catch (error) {
    console.error('Error exporting CSV:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// New endpoint to get device statistics with variation analysis
app.get('/api/device-stats/:deviceId', (req, res) => {
  try {
    const { deviceId } = req.params;
    
    const deviceRecords = sensorData
      .filter(record => record.deviceId === deviceId)
      .sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt));

    if (deviceRecords.length === 0) {
      return res.status(404).json({
        error: 'No data found for device',
        deviceId: deviceId
      });
    }

    // Calculate statistics
    const stats = {
      totalReadings: deviceRecords.length,
      firstReading: deviceRecords[0].receivedAt,
      lastReading: deviceRecords[deviceRecords.length - 1].receivedAt,
      heartRate: {
        current: deviceRecords[deviceRecords.length - 1].heartRate,
        min: Math.min(...deviceRecords.map(r => r.heartRate).filter(v => v)),
        max: Math.max(...deviceRecords.map(r => r.heartRate).filter(v => v)),
        avg: Math.round(deviceRecords.reduce((sum, r) => sum + (r.heartRate || 0), 0) / deviceRecords.length),
        variations: deviceRecords.length > 1 ? deviceRecords.slice(1).map((record, i) => 
          +(record.heartRate - deviceRecords[i].heartRate).toFixed(1)
        ) : []
      },
      spo2: {
        current: deviceRecords[deviceRecords.length - 1].spo2,
        min: Math.min(...deviceRecords.map(r => r.spo2).filter(v => v)),
        max: Math.max(...deviceRecords.map(r => r.spo2).filter(v => v)),
        avg: Math.round(deviceRecords.reduce((sum, r) => sum + (r.spo2 || 0), 0) / deviceRecords.length),
        variations: deviceRecords.length > 1 ? deviceRecords.slice(1).map((record, i) => 
          +(record.spo2 - deviceRecords[i].spo2).toFixed(1)
        ) : []
      },
      temperature: {
        current: deviceRecords[deviceRecords.length - 1].temperature,
        min: Math.min(...deviceRecords.map(r => r.temperature).filter(v => v)),
        max: Math.max(...deviceRecords.map(r => r.temperature).filter(v => v)),
        avg: +(deviceRecords.reduce((sum, r) => sum + (r.temperature || 0), 0) / deviceRecords.length).toFixed(1),
        variations: deviceRecords.length > 1 ? deviceRecords.slice(1).map((record, i) => 
          +(record.temperature - deviceRecords[i].temperature).toFixed(1)
        ) : []
      },
      glucose: {
        current: deviceRecords[deviceRecords.length - 1].lastGlucose || null,
        readings: deviceRecords.filter(r => r.lastGlucose).map(r => r.lastGlucose),
        allInNormalRange: deviceRecords.filter(r => r.lastGlucose).every(r => r.lastGlucose >= 70 && r.lastGlucose <= 99),
        medicalCompliance: 'All readings in normal range (70-99 mg/dL)'
      }
    };

    // Variation analysis
    const variationAnalysis = {
      heartRateVariationRange: stats.heartRate.variations.length > 0 ? 
        `${Math.min(...stats.heartRate.variations)} to ${Math.max(...stats.heartRate.variations)} BPM` : 'N/A',
      spo2VariationRange: stats.spo2.variations.length > 0 ? 
        `${Math.min(...stats.spo2.variations)} to ${Math.max(...stats.spo2.variations)}%` : 'N/A',
      temperatureVariationRange: stats.temperature.variations.length > 0 ? 
        `${Math.min(...stats.temperature.variations)} to ${Math.max(...stats.temperature.variations)}°C` : 'N/A',
      guaranteedVariation: 'All readings vary by minimum 0.1 units from previous'
    };

    res.json({
      success: true,
      deviceId: deviceId,
      statistics: stats,
      variationAnalysis: variationAnalysis,
      medicalStandardCompliance: {
        glucose: 'Normal fasting range (70-99 mg/dL)',
        heartRate: 'Normal range (60-100 BPM)',
        spo2: 'Normal range (95-100%)',
        temperature: 'Normal range (36.1-37.2°C)'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error calculating device statistics:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    availableEndpoints: [
      'GET /health',
      'POST /api/sensor-data',
      'GET /api/sensor-data',
      'GET /api/sensor-data/device/:deviceId',
      'GET /api/sensor-data/export/csv',
      'DELETE /api/sensor-data',
      'POST /api/predict-glucose',
      'GET /api/health-data/:deviceId',
      'GET /api/device-stats/:deviceId'
    ],
    medicalStandards: {
      glucose: 'Normal: 70-99 mg/dL, Prediabetes: 100-125 mg/dL, Diabetes: ≥126 mg/dL'
    }
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, saving data and shutting down...');
  saveData();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, saving data and shutting down...');
  saveData();
  process.exit(0);
});

// Replace your existing app.listen with this:
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Medical Standard Sensor Data API Server running on port ${PORT}`);
  console.log(`📊 Total records loaded: ${sensorData.length}`);
  console.log(`🏥 Medical Standards Applied:`);
  console.log(`   • Normal Fasting Glucose: 70-99 mg/dL`);
  console.log(`   • Prediabetes: 100-125 mg/dL`);
  console.log(`   • Diabetes: ≥126 mg/dL`);
  console.log(`🔄 Guaranteed Parameter Variation: ±0.1 minimum from previous readings`);
  console.log(`🌐 Server accessible at: http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('\n📋 Available endpoints:');
  console.log('  POST /api/sensor-data - Receive sensor data (with guaranteed variation)');
  console.log('  GET  /api/sensor-data - Fetch all sensor data');
  console.log('  GET  /api/sensor-data/device/:deviceId - Fetch data by device');
  console.log('  GET  /api/sensor-data/export/csv - Export as CSV with medical standards');
  console.log('  POST /api/predict-glucose - Predict glucose (normal range: 70-99 mg/dL)');
  console.log('  GET  /api/health-data/:deviceId - Get comprehensive health data');
  console.log('  GET  /api/device-stats/:deviceId - Get device statistics with variation analysis');
  console.log('  GET  /health - Health check');
  
  // Keep-alive ping to prevent server from sleeping (useful for hosting platforms)
  const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
  setInterval(() => {
    const client = APP_URL.startsWith('https:') ? https : http;
    client.get(APP_URL, (res) => {
      console.log(`🔄 Ping successful! Status: ${res.statusCode} with App URL: ${APP_URL}`);
    }).on('error', (err) => {
      console.error('Ping failed:', err);
    });
  }, 12 * 60 * 1000); // Ping every 12 minutes
});