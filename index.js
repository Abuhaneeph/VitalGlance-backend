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

// Function to generate realistic healthy sensor values
const generateHealthyValues = (originalData) => {
  // Get current time for natural variation
  const timeOfDay = new Date().getHours();
  const isRestingTime = timeOfDay >= 22 || timeOfDay <= 6; // 10 PM to 6 AM
  const isActiveTime = timeOfDay >= 9 && timeOfDay <= 18; // 9 AM to 6 PM
  
  // Add some natural variation based on time
  const baseVariation = (Math.random() - 0.5) * 0.2; // ±10% variation
  const timeVariation = isRestingTime ? -0.1 : (isActiveTime ? 0.05 : 0);
  
  // Generate healthy heart rate (60-100 BPM, typically 70-80 for healthy adults)
  let healthyHeartRate;
  if (isRestingTime) {
    healthyHeartRate = 60 + Math.random() * 15; // 60-75 BPM during rest
  } else if (isActiveTime) {
    healthyHeartRate = 70 + Math.random() * 20; // 70-90 BPM during active hours
  } else {
    healthyHeartRate = 65 + Math.random() * 20; // 65-85 BPM normal
  }
  
  // Add slight variation to simulate natural heart rate variability
  healthyHeartRate += (Math.random() - 0.5) * 4;
  healthyHeartRate = Math.round(Math.max(55, Math.min(95, healthyHeartRate)));
  
  // Generate healthy SpO2 (95-100%, typically 97-99% for healthy adults)
  let healthySpO2 = 97 + Math.random() * 2.5; // 97-99.5%
  healthySpO2 = Math.round(Math.max(95, Math.min(100, healthySpO2)));
  
  // Generate healthy body temperature (36.1-37.2°C / 96.98-98.96°F)
  let healthyTemp = 36.3 + Math.random() * 0.8; // 36.3-37.1°C
  // Add slight variation based on time of day (body temp is typically lower in morning)
  if (timeOfDay >= 6 && timeOfDay <= 10) {
    healthyTemp -= 0.2; // Slightly lower in morning
  } else if (timeOfDay >= 16 && timeOfDay <= 20) {
    healthyTemp += 0.1; // Slightly higher in evening
  }
  healthyTemp = Math.round(healthyTemp * 100) / 100; // Round to 2 decimal places
  
  // Generate realistic raw sensor values
  const healthyRed = 80000 + Math.random() * 40000; // Good signal strength
  const healthyIR = 85000 + Math.random() * 35000; // Good signal strength
  
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
    red: Math.round(healthyRed),
    ir: Math.round(healthyIR),
    fingerDetected: true,
    simulatedHealthy: true, // Flag to indicate this is simulated healthy data
    originalValues: {
      heartRate: originalData.heartRate,
      spo2: originalData.spo2,
      temperature: originalData.temperature,
      red: originalData.red,
      ir: originalData.ir
    }
  };
};

// Function to simulate healthy glucose levels
const simulateHealthyGlucose = (heartRate, heartRateAvg, spo2, temperature) => {
  // Get current time for natural variation
  const timeOfDay = new Date().getHours();
  const isPostMealTime = (timeOfDay >= 8 && timeOfDay <= 10) || 
                        (timeOfDay >= 12 && timeOfDay <= 14) || 
                        (timeOfDay >= 18 && timeOfDay <= 20);
  const isFastingTime = timeOfDay >= 22 || timeOfDay <= 7;
  
  // Base healthy glucose range
  let baseGlucose;
  if (isFastingTime) {
    // Fasting glucose: 70-99 mg/dL (normal range)
    baseGlucose = 75 + Math.random() * 20; // 75-95 mg/dL
  } else if (isPostMealTime) {
    // Post-meal glucose: can be higher but still healthy
    baseGlucose = 85 + Math.random() * 25; // 85-110 mg/dL
  } else {
    // Regular daytime glucose
    baseGlucose = 80 + Math.random() * 15; // 80-95 mg/dL
  }
  
  // Add small variations based on vital signs (simulate correlation)
  let variation = 0;
  
  // Heart rate influence (minimal)
  if (heartRate > 80) {
    variation += 2; // Slightly higher glucose with elevated HR
  } else if (heartRate < 65) {
    variation -= 2; // Slightly lower glucose with low HR
  }
  
  // Temperature influence (minimal)
  if (temperature > 37.0) {
    variation += 3; // Slightly higher glucose with elevated temp
  } else if (temperature < 36.5) {
    variation -= 1; // Slightly lower glucose with low temp
  }
  
  // SpO2 influence (minimal)
  if (spo2 < 97) {
    variation += 1; // Slightly higher glucose with lower oxygen
  }
  
  // Apply variation and add some random noise
  const finalGlucose = baseGlucose + variation + (Math.random() - 0.5) * 4;
  
  // Ensure it stays within healthy range (70-110 mg/dL)
  const clampedGlucose = Math.max(70, Math.min(110, finalGlucose));
  
  return Math.round(clampedGlucose * 10) / 10; // Round to 1 decimal place
};

// Function to interpret glucose levels
const interpretGlucose = (glucoseLevel) => {
  if (glucoseLevel < 70) {
    return { category: 'Low', status: 'warning', message: 'Hypoglycemia - consult healthcare provider' };
  } else if (glucoseLevel >= 70 && glucoseLevel <= 99) {
    return { category: 'Normal', status: 'good', message: 'Normal glucose level' };
  } else if (glucoseLevel >= 100 && glucoseLevel <= 125) {
    return { category: 'Pre-diabetic', status: 'caution', message: 'Pre-diabetic range - monitor closely' };
  } else {
    return { category: 'High', status: 'warning', message: 'Diabetic range - consult healthcare provider' };
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
    glucoseSimulation: 'enabled',
    healthySimulation: true // Indicate healthy simulation is active
  });
});

// POST endpoint to receive sensor data (MODIFIED to simulate healthy values)
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

    // Generate healthy values based on the original data
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

    console.log(`Received data from ${healthyData.deviceId} - HEALTHY SIMULATION:`);
    console.log(`  HR: ${healthyData.heartRate} BPM (original: ${originalData.heartRate || 'N/A'})`);
    console.log(`  SPO2: ${healthyData.spo2}% (original: ${originalData.spo2 || 'N/A'})`);
    console.log(`  Temp: ${healthyData.temperature}°C (original: ${originalData.temperature || 'N/A'})`);

    res.status(201).json({
      success: true,
      message: 'Data received and converted to healthy values',
      recordId: record.id,
      totalRecords: sensorData.length,
      simulatedHealthy: true,
      healthyValues: {
        heartRate: healthyData.heartRate,
        spo2: healthyData.spo2,
        temperature: healthyData.temperature,
        red: healthyData.red,
        ir: healthyData.ir
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

// POST endpoint to predict glucose level from sensor data (MODIFIED to simulate)
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
        requiredFields: ['heartRate', 'heartRateAvg', 'spo2', 'temperature']
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

    // Simulate healthy glucose level
    const predictedGlucose = simulateHealthyGlucose(heartRate, avgHeartRate, spo2, temperature);
    const interpretation = interpretGlucose(predictedGlucose);

    // Store prediction record
    const predictionRecord = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      deviceId: deviceId || 'unknown',
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
      simulatedGlucose: true
    };

    console.log(`Glucose simulation for ${deviceId || 'unknown'}: ${predictedGlucose} mg/dL (${interpretation.category})`);

    res.json({
      success: true,
      timestamp: predictionRecord.timestamp,
      deviceId: predictionRecord.deviceId,
      input: predictionRecord.input,
      prediction: predictionRecord.prediction,
      simulatedGlucose: true,
      disclaimers: [
        'This is a simulated glucose value for demonstration purposes',
        'Not a substitute for professional medical diagnosis',
        'Consult healthcare provider for medical decisions',
        'Use actual glucose monitoring devices for real measurements'
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

// Comprehensive health data endpoint - returns temperature, SpO2, glucose simulation, and all relevant data
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

      // Temperature interpretation (assuming Celsius)
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

    // Simulate glucose level
    const predictedGlucose = simulateHealthyGlucose(heartRate, avgHeartRate, spo2, temperature);
    const glucoseInterpretation = interpretGlucose(predictedGlucose);
    
    const glucosePrediction = {
      value: predictedGlucose,
      unit: 'mg/dL',
      category: glucoseInterpretation.category,
      status: glucoseInterpretation.status,
      message: glucoseInterpretation.message,
      confidence: 'Simulated',
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

      // Consider glucose if available
      if (glucose && glucose.status === 'warning') {
        score -= 15;
        factors.push(`Glucose: ${glucose.message}`);
      } else if (glucose && glucose.status === 'caution') {
        score -= 8;
        factors.push(`Glucose: ${glucose.message}`);
      }

      score = Math.max(0, score); // Ensure score doesn't go below 0

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
          simulatedHealthy: record.simulatedHealthy
        }));
    }

    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      deviceId: deviceId,
      simulatedHealthy: latestReading.simulatedHealthy || false,
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

    // Add original values if this was simulated
    if (latestReading.originalValues) {
      response.originalValues = latestReading.originalValues;
    }

    // Add medical disclaimers
    response.disclaimers = [
      'This data is for educational purposes only',
      'Glucose values are predicted for educational purposes',
      'Consult healthcare provider for medical decisions',
      'Sensor accuracy may vary based on placement and conditions',
      'Values have been simulated to show healthy ranges'
    ];

    console.log(`Comprehensive health data for ${deviceId}: HR=${heartRate}, SpO2=${spo2}%, Temp=${temperature}°C, Glucose=${glucosePrediction.value} (simulated)`);

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
      simulatedHealthy: true
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

    res.json({
      success: true,
      deviceId: deviceId,
      data: deviceData,
      totalRecords: deviceData.length,
      simulatedHealthy: true
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

    // Generate CSV
    const headers = Object.keys(dataToExport[0]).join(',');
    const rows = dataToExport.map(record => 
      Object.values(record).map(val => 
        typeof val === 'string' ? `"${val}"` : val
      ).join(',')
    );
    
    const csv = [headers, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="sensor_data_${Date.now()}.csv"`);
    res.send(csv);

  } catch (error) {
    console.error('Error exporting CSV:', error);
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
      'GET /api/health-data/:deviceId'
    ]
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
  console.log(`🚀 Sensor Data API Server running on port ${PORT}`);
  console.log(`📊 Total records loaded: ${sensorData.length}`);
 
  console.log(`🌐 Server accessible at: http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('\n📋 Available endpoints:');
  console.log('  POST /api/sensor-data - Receive sensor data');
  console.log('  GET  /api/sensor-data - Fetch all sensor data');
  console.log('  GET  /api/sensor-data/device/:deviceId - Fetch data by device');
  console.log('  GET  /api/sensor-data/export/csv - Export as CSV');
  console.log('  POST /api/predict-glucose - Predict glucose from input data');
  console.log('  GET  /api/health-data/:deviceId - Get comprehensive health data');
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
  }, 12 * 60 * 1000); // Ping every 5 minutes
});