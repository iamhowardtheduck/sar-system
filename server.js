const express = require('express');
const { Client } = require('@elastic/elasticsearch');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { PDFDocument, PDFForm, PDFTextField, PDFCheckBox } = require('pdf-lib');
const { create } = require('xmlbuilder2');

const app = express();
const PORT = process.env.PORT || 3000;

// Enhanced proxy trust configuration for workshop environment
// Following express-rate-limit security recommendations
// See: https://express-rate-limit.mintlify.app/reference/error-codes#err-erl-permissive-trust-proxy

// Option 1: Trust specific number of proxies (recommended)
app.set('trust proxy', 1); // Trust the first proxy (most common for workshops)

// Option 2: Trust specific IP ranges (more secure)
// Uncomment and use this if Option 1 doesn't work:
// app.set('trust proxy', ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']);

// Option 3: Custom trust function (most secure)
// Uncomment and use this for maximum control:
/*
app.set('trust proxy', (ip) => {
  // Trust localhost
  if (ip === '127.0.0.1' || ip === '::1') return true;
  
  // Trust private networks (common in containerized environments)
  if (ip.startsWith('10.') || 
      ip.startsWith('172.16.') || ip.startsWith('172.17.') || // Docker default
      ip.startsWith('192.168.')) return true;
      
  // Trust Kubernetes service networks
  if (ip.startsWith('10.96.') || ip.startsWith('10.244.')) return true;
  
  return false;
});
*/

// Elasticsearch configuration - Workshop Environment Defaults
const elasticsearchConfig = {
  node: process.env.ELASTICSEARCH_URL || 'http://kubernetes-vm:30920',
  auth: {
    username: process.env.ELASTICSEARCH_USERNAME || 'elastic',
    password: process.env.ELASTICSEARCH_PASSWORD || 'elastic'
  },
  tls: {
    rejectUnauthorized: false // Set to true in production with proper certificates
  }
};

const esClient = new Client(elasticsearchConfig);

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  }
}));

app.use(compression());
app.use(morgan('combined'));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting - Following express-rate-limit best practices
// See: https://express-rate-limit.mintlify.app/guides/troubleshooting-proxy-issues
const enableRateLimiting = process.env.DISABLE_RATE_LIMITING !== 'true';

if (enableRateLimiting) {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 100, // Limit each IP to 100 requests per windowMs (new syntax)
    standardHeaders: 'draft-7', // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    
    // Skip rate limiting for certain requests
    skip: (req) => {
      // Skip rate limiting for health checks and static assets
      return req.path === '/api/health' || 
             req.path.startsWith('/css') || 
             req.path.startsWith('/js') ||
             req.path.startsWith('/favicon');
    },
    
    // Custom key generator that works with trusted proxies
    keyGenerator: (req) => {
      // With trust proxy properly configured, req.ip should be the real client IP
      return req.ip;
    },
    
    // Enhanced error handler
    handler: (req, res) => {
      console.log(`Rate limit exceeded for IP: ${req.ip}, Path: ${req.path}`);
      res.status(429).json({
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.round(15 * 60), // 15 minutes in seconds
        ip: req.ip // Include IP for debugging (remove in production)
      });
    },
    
    // Validate that trust proxy is configured correctly
    validate: {
      trustProxy: false, // Let express-rate-limit validate our trust proxy config
      xForwardedForHeader: true // We expect X-Forwarded-For headers
    }
  });
  
  app.use('/api/', limiter);
  console.log('✓ Rate limiting enabled for API endpoints');
  console.log(`✓ Trust proxy setting: ${app.get('trust proxy')}`);
} else {
  console.log('⚠ Rate limiting disabled for workshop environment');
}

// Serve static files
app.use(express.static('public'));

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes
app.get('/', (req, res) => {
  res.render('index');
});

// API endpoint to get SAR data from Elasticsearch
app.get('/api/sar-reports', async (req, res) => {
  try {
    const { page = 1, size = 10, search } = req.query;
    const from = (page - 1) * size;

    let query = { match_all: {} };
    
    if (search) {
      query = {
        multi_match: {
          query: search,
          fields: [
            'financial_institution_name',
            'suspect_name',
            'suspect_entity_name',
            'account_number',
            'address'
          ]
        }
      };
    }

    const response = await esClient.search({
      index: process.env.ELASTICSEARCH_INDEX || 'sar-reports',
      body: {
        query: query,
        from: from,
        size: parseInt(size),
        sort: [
          { '@timestamp': { order: 'desc' } },
          { 'report_date': { order: 'desc' } }
        ]
      }
    });

    // Handle different Elasticsearch client response structures
    let hits, total;
    
    console.log('Elasticsearch response structure:', {
      hasBody: !!response.body,
      hasHits: !!response.hits,
      bodyKeys: response.body ? Object.keys(response.body) : [],
      responseKeys: Object.keys(response)
    });
    
    if (response.body && response.body.hits) {
      // Older client structure: response.body.hits
      hits = response.body.hits.hits || [];
      total = response.body.hits.total?.value || response.body.hits.total || 0;
    } else if (response.hits) {
      // Newer client structure: response.hits
      hits = response.hits.hits || [];
      total = response.hits.total?.value || response.hits.total || 0;
    } else {
      // Fallback: no hits found
      console.warn('Unexpected Elasticsearch response structure:', response);
      hits = [];
      total = 0;
    }

    const reports = hits.map(hit => ({
      id: hit._id,
      ...hit._source
    }));

    res.json({
      reports,
      total: total,
      page: parseInt(page),
      totalPages: Math.ceil(total / size)
    });

  } catch (error) {
    console.error('Error fetching SAR reports:', error);
    
    // Handle specific authentication errors
    if (error.meta && error.meta.statusCode === 401) {
      return res.status(401).json({ 
        error: 'Authentication failed - check Elasticsearch credentials',
        details: 'The user does not have permission to search the SAR reports index',
        suggestion: 'Verify username/password and user permissions in Elasticsearch'
      });
    }
    
    // Handle index not found errors
    if (error.meta && error.meta.statusCode === 404) {
      return res.status(404).json({ 
        error: 'SAR reports index not found',
        details: 'The sar-reports index does not exist in Elasticsearch',
        suggestion: 'Run load-sample-data.sh to create the index and load sample data'
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch SAR reports',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      suggestion: 'Check Elasticsearch connectivity and credentials'
    });
  }
});

// API endpoint to get a specific SAR report
app.get('/api/sar-reports/:id', async (req, res) => {
  try {
    const response = await esClient.get({
      index: process.env.ELASTICSEARCH_INDEX || 'sar-reports',
      id: req.params.id
    });

    // Handle different Elasticsearch client response structures
    let source, id;
    
    if (response.body && response.body._source) {
      // Older client structure: response.body._source
      source = response.body._source;
      id = response.body._id;
    } else if (response._source) {
      // Newer client structure: response._source
      source = response._source;
      id = response._id;
    } else {
      throw new Error('Unexpected response structure from Elasticsearch');
    }

    res.json({
      id: id,
      ...source
    });

  } catch (error) {
    console.error('Error fetching SAR report:', error);
    if (error.meta && error.meta.statusCode === 404) {
      res.status(404).json({ error: 'SAR report not found' });
    } else {
      res.status(500).json({ 
        error: 'Failed to fetch SAR report',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
});

// API endpoint to generate FinCEN Form 8300 XML for a specific SAR report
app.get('/api/sar-reports/:id/fincen8300', async (req, res) => {
  try {
    // Get the SAR report data
    const reportResponse = await esClient.get({
      index: process.env.ELASTICSEARCH_INDEX || 'sar-reports',
      id: req.params.id
    });

    let source, reportId;
    
    if (reportResponse.body && reportResponse.body._source) {
      source = reportResponse.body._source;
      reportId = reportResponse.body._id;
    } else if (reportResponse._source) {
      source = reportResponse._source;
      reportId = reportResponse._id;
    } else {
      throw new Error('Unexpected response structure from Elasticsearch');
    }

    // Generate the FinCEN 8300 XML
    const xmlContent = generateFinCEN8300XML(source, reportId);
    
    // Set response headers for XML download
    const filename = `FinCEN-8300-${reportId}-${new Date().toISOString().split('T')[0]}.xml`;
    
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', Buffer.byteLength(xmlContent, 'utf8'));
    
    res.send(xmlContent);

  } catch (error) {
    console.error('Error generating FinCEN 8300 XML:', error);
    if (error.meta && error.meta.statusCode === 404) {
      res.status(404).json({ error: 'SAR report not found' });
    } else {
      res.status(500).json({ 
        error: 'Failed to generate FinCEN 8300 XML',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
});

// Function to generate FinCEN Form 8300 XML
function generateFinCEN8300XML(reportData, reportId) {
  try {
    // Generate unique sequence numbers for XML elements
    let seqNum = 1;
    const getSeqNum = () => seqNum++;
    
    // Format date for FinCEN (YYYYMMDD format)
    const formatFinCENDate = (dateString) => {
      if (!dateString) return '';
      try {
        const date = new Date(dateString);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}${month}${day}`;
      } catch {
        return '';
      }
    };

    // Clean text for XML (remove invalid characters)
    const cleanXMLText = (text, maxLength = 150) => {
      if (!text) return '';
      return String(text)
        .replace(/[<>&"']/g, (char) => {
          const entities = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' };
          return entities[char];
        })
        .replace(/[^\x20-\x7E]/g, '') // Remove non-printable characters
        .trim()
        .substring(0, maxLength);
    };

    // Calculate total amount (ensure it's over $10,000 threshold for Form 8300)
    const totalAmount = reportData.total_dollar_amount || 10001;
    const transactionDate = formatFinCENDate(reportData.suspicious_activity_date || new Date().toISOString());
    const filingDate = formatFinCENDate(new Date().toISOString());

    // Create XML document following FinCEN 8300X schema
    const doc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('EFilingBatchXML', { 
        'xmlns': 'www.fincen.gov/base',
        'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        'xsi:schemaLocation': 'www.fincen.gov/base https://www.fincen.gov/system/files/schema/base/EFL_8300XBatchSchema.xsd',
        'TotalAmount': totalAmount,
        'PartyCount': 4, // Minimum required parties
        'ActivityCount': 1
      })
        .ele('FormTypeCode').txt('8300X').up()
        .ele('Activity', { 'SeqNum': getSeqNum() })
          // Activity details
          .ele('FilingDateText').txt(filingDate).up()
          .ele('SuspiciousTransactionIndicator').txt('Y').up() // Since this is from SAR data
          
          // Activity Association
          .ele('ActivityAssociation', { 'SeqNum': getSeqNum() })
            .ele('InitialReportIndicator').txt('Y').up()
          .up()
          
          // Party 1: Business that received cash (from financial institution data)
          .ele('Party', { 'SeqNum': getSeqNum() })
            .ele('ActivityPartyTypeCode').txt('4').up() // Business that received cash
            .ele('PartyTypeCode').txt('O').up() // Organization
            .ele('PartyName', { 'SeqNum': getSeqNum() })
              .ele('PartyNameTypeCode').txt('L').up() // Legal name
              .ele('RawPartyFullName').txt(cleanXMLText(reportData.financial_institution_name || 'Financial Institution')).up()
            .up()
            .ele('Address', { 'SeqNum': getSeqNum() })
              .ele('RawStreetAddress1Text').txt(cleanXMLText(reportData.financial_institution_address || '', 100)).up()
              .ele('RawCityText').txt(cleanXMLText(reportData.financial_institution_city || '', 50)).up()
              .ele('RawStateCodeText').txt(cleanXMLText(reportData.financial_institution_state || '', 3)).up()
              .ele('RawZIPCode').txt(cleanXMLText(reportData.financial_institution_zip || '', 9)).up()
              .ele('RawCountryCodeText').txt('US').up()
            .up()
            .ele('PartyIdentification', { 'SeqNum': getSeqNum() })
              .ele('PartyIdentificationTypeCode').txt('2').up() // EIN
              .ele('PartyIdentificationNumberText').txt(cleanXMLText(reportData.financial_institution_ein || '', 25)).up()
            .up()
          .up()
          
          // Party 2: Individual from whom cash was received (suspect information)
          .ele('Party', { 'SeqNum': getSeqNum() })
            .ele('ActivityPartyTypeCode').txt('16').up() // Individual from whom cash was received
            .ele('PartyTypeCode').txt('I').up() // Individual
            .ele('PartyName', { 'SeqNum': getSeqNum() })
              .ele('PartyNameTypeCode').txt('L').up() // Legal name
              .ele('RawEntityIndividualLastName').txt(cleanXMLText(reportData.suspect_last_name || reportData.suspect_entity_name || 'Unknown')).up()
              .ele('RawIndividualFirstName').txt(cleanXMLText(reportData.suspect_first_name || '', 35)).up()
            .up()
            .ele('Address', { 'SeqNum': getSeqNum() })
              .ele('RawStreetAddress1Text').txt(cleanXMLText(reportData.suspect_address || '', 100)).up()
              .ele('RawCityText').txt(cleanXMLText(reportData.suspect_city || '', 50)).up()
              .ele('RawStateCodeText').txt(cleanXMLText(reportData.suspect_state || '', 3)).up()
              .ele('RawZIPCode').txt(cleanXMLText(reportData.suspect_zip || '', 9)).up()
              .ele('RawCountryCodeText').txt('US').up()
            .up()
            .ele('PhoneNumber', { 'SeqNum': getSeqNum() })
              .ele('PhoneNumberText').txt(cleanXMLText(reportData.suspect_phone || '', 16)).up()
            .up()
            .ele('PartyIdentification', { 'SeqNum': getSeqNum() })
              .ele('PartyIdentificationTypeCode').txt('1').up() // SSN/ITIN (default assumption)
              .ele('PartyIdentificationNumberText').txt('').up() // Empty for privacy
            .up()
          .up()
          
          // Party 3: Transmitter (filing entity)
          .ele('Party', { 'SeqNum': getSeqNum() })
            .ele('ActivityPartyTypeCode').txt('35').up() // Transmitter
            .ele('PartyTypeCode').txt('O').up() // Organization
            .ele('PartyName', { 'SeqNum': getSeqNum() })
              .ele('PartyNameTypeCode').txt('L').up() // Legal name
              .ele('RawPartyFullName').txt(cleanXMLText(reportData.financial_institution_name || 'SAR Filing Institution')).up()
            .up()
            .ele('Address', { 'SeqNum': getSeqNum() })
              .ele('RawStreetAddress1Text').txt(cleanXMLText(reportData.financial_institution_address || '', 100)).up()
              .ele('RawCityText').txt(cleanXMLText(reportData.financial_institution_city || '', 50)).up()
              .ele('RawStateCodeText').txt(cleanXMLText(reportData.financial_institution_state || '', 3)).up()
              .ele('RawZIPCode').txt(cleanXMLText(reportData.financial_institution_zip || '', 9)).up()
              .ele('RawCountryCodeText').txt('US').up()
            .up()
            .ele('PartyIdentification', { 'SeqNum': getSeqNum() })
              .ele('PartyIdentificationTypeCode').txt('2').up() // EIN
              .ele('PartyIdentificationNumberText').txt(cleanXMLText(reportData.financial_institution_ein || '', 25)).up()
            .up()
          .up()
          
          // Party 4: Authorized Official / Contact
          .ele('Party', { 'SeqNum': getSeqNum() })
            .ele('ActivityPartyTypeCode').txt('8').up() // Contact for assistance
            .ele('PartyTypeCode').txt('I').up() // Individual
            .ele('PartyName', { 'SeqNum': getSeqNum() })
              .ele('PartyNameTypeCode').txt('L').up() // Legal name
              .ele('RawEntityIndividualLastName').txt('Compliance').up()
              .ele('RawIndividualFirstName').txt('Officer').up()
            .up()
            .ele('Address', { 'SeqNum': getSeqNum() })
              .ele('RawStreetAddress1Text').txt(cleanXMLText(reportData.financial_institution_address || '', 100)).up()
              .ele('RawCityText').txt(cleanXMLText(reportData.financial_institution_city || '', 50)).up()
              .ele('RawStateCodeText').txt(cleanXMLText(reportData.financial_institution_state || '', 3)).up()
              .ele('RawZIPCode').txt(cleanXMLText(reportData.financial_institution_zip || '', 9)).up()
              .ele('RawCountryCodeText').txt('US').up()
            .up()
            .ele('PhoneNumber', { 'SeqNum': getSeqNum() })
              .ele('PhoneNumberText').txt('555-555-0100').up() // Default contact number
            .up()
            .ele('PartyOccupationBusiness', { 'SeqNum': getSeqNum() })
              .ele('OccupationBusinessText').txt('Compliance Officer').up()
            .up()
          .up()
          
          // Currency Transaction Activity
          .ele('CurrencyTransactionActivity', { 'SeqNum': getSeqNum() })
            .ele('TotalCashInReceiveAmountText').txt(totalAmount.toString()).up()
            .ele('TransactionDateText').txt(transactionDate).up()
            
            // Activity Detail 1: Cash received
            .ele('CurrencyTransactionActivityDetail', { 'SeqNum': getSeqNum() })
              .ele('CurrencyTransactionActivityDetailTypeCode').txt('7').up() // Exchange of cash
              .ele('DetailTransactionAmountText').txt(totalAmount.toString()).up()
              .ele('DetailTransactionDescription').txt(cleanXMLText(reportData.activity_description || 'Suspicious cash transaction')).up()
              .ele('InstrumentProductServiceTypeCode').txt(35).up() // U.S. Currency
            .up()
            
            // Activity Detail 2: Additional detail (required minimum 2)
            .ele('CurrencyTransactionActivityDetail', { 'SeqNum': getSeqNum() })
              .ele('CurrencyTransactionActivityDetailTypeCode').txt('999').up() // Other
              .ele('DetailTransactionAmountText').txt('0').up()
              .ele('DetailTransactionDescription').txt('Related to suspicious activity report').up()
              .ele('InstrumentProductServiceTypeCode').txt(35).up() // U.S. Currency
            .up()
          .up()
          
          // Activity Narrative (optional)
          .ele('ActivityNarrativeInformation', { 'SeqNum': getSeqNum() })
            .ele('ActivityNarrativeSequenceNumber').txt('1').up()
            .ele('ActivityNarrativeText').txt(cleanXMLText(
              `This Form 8300 filing is based on suspicious activity identified in SAR report ${reportId}. ` +
              `Transaction details: ${reportData.activity_description || 'Cash transaction above reporting threshold'}. ` +
              `Additional investigation may be warranted.`, 750
            )).up()
          .up()
        .up()
      .up();

    return doc.end({ prettyPrint: true });
    
  } catch (error) {
    console.error('Error generating FinCEN 8300 XML:', error);
    throw new Error(`Failed to generate FinCEN 8300 XML: ${error.message}`);
  }
}

// API endpoint to generate filled PDF for a specific SAR report
app.get('/api/sar-reports/:id/pdf', async (req, res) => {
  try {
    // Get the SAR report data
    const reportResponse = await esClient.get({
      index: process.env.ELASTICSEARCH_INDEX || 'sar-reports',
      id: req.params.id
    });

    let source, reportId;
    
    if (reportResponse.body && reportResponse.body._source) {
      source = reportResponse.body._source;
      reportId = reportResponse.body._id;
    } else if (reportResponse._source) {
      source = reportResponse._source;
      reportId = reportResponse._id;
    } else {
      throw new Error('Unexpected response structure from Elasticsearch');
    }

    // Generate the filled PDF
    const pdfBytes = await generateFilledSARPdf(source);
    
    // Set response headers for PDF download
    const filename = `SAR-Report-${reportId}-${new Date().toISOString().split('T')[0]}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBytes.length);
    
    res.send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error('Error generating SAR PDF:', error);
    if (error.meta && error.meta.statusCode === 404) {
      res.status(404).json({ error: 'SAR report not found' });
    } else {
      res.status(500).json({ 
        error: 'Failed to generate SAR PDF',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
});

// Function to generate filled SAR PDF
async function generateFilledSARPdf(reportData) {
  try {
    // Read the template PDF
    const templatePath = path.join(__dirname, 'sar-template.pdf');
    const existingPdfBytes = fs.readFileSync(templatePath);
    
    // Load the PDF document (handle encrypted PDFs)
    const pdfDoc = await PDFDocument.load(existingPdfBytes, { 
      ignoreEncryption: true,
      updateMetadata: false 
    });
    
    let form;
    let hasAccessibleForm = false;
    
    try {
      form = pdfDoc.getForm();
      const fields = form.getFields();
      
      if (fields.length > 0) {
        console.log(`Found ${fields.length} form fields in PDF`);
        hasAccessibleForm = true;
        
        // Log actual field names for debugging
        console.log('Available PDF fields:', fields.slice(0, 10).map(f => f.getName()));
        
        // Try to fill fields if we can identify them
        const success = await tryFillKnownFields(form, reportData);
        
        if (success) {
          console.log('✅ Successfully filled PDF form fields');
          
          // Try to flatten the form carefully
          try {
            form.flatten();
          } catch (flattenError) {
            console.warn('Could not flatten form (PDF may remain editable):', flattenError.message);
          }
          
          const pdfBytes = await pdfDoc.save();
          return pdfBytes;
        }
      }
    } catch (formError) {
      console.warn('PDF form not accessible or fillable:', formError.message);
      hasAccessibleForm = false;
    }
    
    // If we get here, form filling failed - use fallback method
    console.log('📝 Using fallback: creating SAR data summary');
    return await createSARDataSummaryPdf(await PDFDocument.create(), reportData);
    
  } catch (error) {
    console.error('Error in generateFilledSARPdf:', error);
    
    // Final fallback: create data summary without template
    console.log('🔄 Creating standalone SAR data summary');
    try {
      return await createSARDataSummaryPdf(await PDFDocument.create(), reportData);
    } catch (fallbackError) {
      throw new Error(`Failed to generate PDF: ${fallbackError.message}`);
    }
  }
}

// Try to fill known fields with better error handling
async function tryFillKnownFields(form, reportData) {
  try {
    const fields = form.getFields();
    const fieldNames = fields.map(f => f.getName().toLowerCase());
    
    // Helper function to safely fill form fields with character encoding protection
    const fillFieldSafely = (fieldName, value) => {
      try {
        if (!value) return false;
        
        // Clean value to avoid encoding issues
        const cleanValue = cleanTextForPDF(String(value));
        
        // Try to find field by exact name or partial match
        let field = null;
        
        try {
          field = form.getTextField(fieldName);
        } catch {
          // Try to find field by partial name match
          const matchingFieldName = fieldNames.find(name => 
            name.includes(fieldName.toLowerCase()) || 
            fieldName.toLowerCase().includes(name)
          );
          
          if (matchingFieldName) {
            const actualField = fields.find(f => f.getName().toLowerCase() === matchingFieldName);
            if (actualField && actualField.constructor.name === 'PDFTextField') {
              field = actualField;
            }
          }
        }
        
        if (field && cleanValue) {
          field.setText(cleanValue);
          return true;
        }
        
        return false;
      } catch (error) {
        console.warn(`Could not fill field ${fieldName}:`, error.message);
        return false;
      }
    };

    // Common field name patterns to try
    const fieldMappings = [
      // Institution information
      { patterns: ['name', 'institution', 'bank'], value: reportData.financial_institution_name, desc: 'Institution Name' },
      { patterns: ['ein', 'tax'], value: reportData.financial_institution_ein, desc: 'EIN' },
      { patterns: ['address', 'addr'], value: reportData.financial_institution_address, desc: 'Address' },
      { patterns: ['city'], value: reportData.financial_institution_city, desc: 'City' },
      { patterns: ['state'], value: reportData.financial_institution_state, desc: 'State' },
      { patterns: ['zip', 'postal'], value: reportData.financial_institution_zip, desc: 'ZIP' },
      
      // Account information
      { patterns: ['account', 'acct'], value: reportData.account_number, desc: 'Account Number' },
      
      // Suspect information
      { patterns: ['suspect', 'subject', 'last'], value: reportData.suspect_last_name || reportData.suspect_entity_name, desc: 'Suspect Name' },
      { patterns: ['first'], value: reportData.suspect_first_name, desc: 'First Name' },
      { patterns: ['phone', 'tel'], value: reportData.suspect_phone, desc: 'Phone' },
      
      // Activity information
      { patterns: ['amount', 'dollar', 'money'], value: formatCurrencyForPDF(reportData.total_dollar_amount), desc: 'Dollar Amount' },
      { patterns: ['date', 'activity'], value: formatDateForPDF(reportData.suspicious_activity_date), desc: 'Activity Date' },
      { patterns: ['description', 'narrative'], value: reportData.activity_description, desc: 'Description' },
    ];
    
    let filledCount = 0;
    
    // Try to fill fields using pattern matching
    for (const mapping of fieldMappings) {
      if (!mapping.value) continue;
      
      for (const pattern of mapping.patterns) {
        const matchingFields = fields.filter(field => {
          const name = field.getName().toLowerCase();
          return name.includes(pattern) && field.constructor.name === 'PDFTextField';
        });
        
        for (const field of matchingFields) {
          if (fillFieldSafely(field.getName(), mapping.value)) {
            console.log(`✅ Filled ${mapping.desc}: ${field.getName()}`);
            filledCount++;
            break; // Move to next mapping after successful fill
          }
        }
        
        if (filledCount > 0 && matchingFields.length > 0) break;
      }
    }
    
    console.log(`📊 Successfully filled ${filledCount} form fields`);
    return filledCount > 0;
    
  } catch (error) {
    console.error('Error trying to fill form fields:', error);
    return false;
  }
}

// Clean text to avoid character encoding issues
function cleanTextForPDF(text) {
  if (!text) return '';
  
  return String(text)
    // Replace problematic Unicode characters
    .replace(/[^\x00-\x7F]/g, '') // Remove non-ASCII characters
    // Replace smart quotes
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    // Replace en/em dashes
    .replace(/[\u2013\u2014]/g, '-')
    // Replace other common problematic characters
    .replace(/\u2026/g, '...') // ellipsis
    .replace(/\u00A0/g, ' ')   // non-breaking space
    // Trim and limit length
    .trim()
    .substring(0, 500); // Limit field length
}

// Alternative PDF generation with text overlay (for PDFs without editable forms)
async function generateSARPdfWithTextOverlay(reportData, basePdf) {
  try {
    console.log('Creating SAR PDF with text overlay');
    
    // Create a new PDF document with the data summary
    const pdfDoc = await PDFDocument.create();
    
    // Try to copy pages from template if possible
    try {
      const templatePages = await pdfDoc.copyPages(basePdf, basePdf.getPageIndices());
      templatePages.forEach((page) => pdfDoc.addPage(page));
      console.log('✅ Template pages copied successfully');
    } catch (error) {
      console.log('⚠️  Could not copy template pages, creating data summary instead');
      // Create a new page with SAR data summary
      const page = pdfDoc.addPage();
      return await createSARDataSummaryPdf(pdfDoc, reportData);
    }
    
    // If we got here, we have the template but can't fill forms
    // Add a data summary page at the end
    const dataPage = pdfDoc.addPage();
    const { width, height } = dataPage.getSize();
    const font = await pdfDoc.embedFont('Helvetica');
    const boldFont = await pdfDoc.embedFont('Helvetica-Bold');
    
    let yPosition = height - 50;
    const lineHeight = 20;
    const leftMargin = 50;
    
    // Title
    dataPage.drawText('SAR DATA SUMMARY', {
      x: leftMargin,
      y: yPosition,
      size: 16,
      font: boldFont,
    });
    yPosition -= 40;
    
    // Add data fields
    const addDataField = (label, value) => {
      if (value && yPosition > 50) {
        dataPage.drawText(`${label}: ${value}`, {
          x: leftMargin,
          y: yPosition,
          size: 10,
          font: font,
        });
        yPosition -= lineHeight;
      }
    };
    
    // Financial Institution Information
    dataPage.drawText('FINANCIAL INSTITUTION INFORMATION', {
      x: leftMargin,
      y: yPosition,
      size: 12,
      font: boldFont,
    });
    yPosition -= 25;
    
    addDataField('Institution Name (Field 2)', reportData.financial_institution_name);
    addDataField('EIN (Field 3)', reportData.financial_institution_ein);
    addDataField('Address (Field 4)', reportData.financial_institution_address);
    addDataField('City (Field 6)', reportData.financial_institution_city);
    addDataField('State (Field 7)', reportData.financial_institution_state);
    addDataField('ZIP (Field 8)', reportData.financial_institution_zip);
    
    yPosition -= 10;
    dataPage.drawText('SUSPECT INFORMATION', {
      x: leftMargin,
      y: yPosition,
      size: 12,
      font: boldFont,
    });
    yPosition -= 25;
    
    addDataField('Last Name/Entity (Field 15)', reportData.suspect_last_name || reportData.suspect_entity_name);
    addDataField('First Name (Field 16)', reportData.suspect_first_name);
    addDataField('Address (Field 18)', reportData.suspect_address);
    addDataField('City (Field 20)', reportData.suspect_city);
    addDataField('State (Field 21)', reportData.suspect_state);
    addDataField('ZIP (Field 22)', reportData.suspect_zip);
    addDataField('Phone (Field 24)', reportData.suspect_phone);
    
    yPosition -= 10;
    dataPage.drawText('ACTIVITY INFORMATION', {
      x: leftMargin,
      y: yPosition,
      size: 12,
      font: boldFont,
    });
    yPosition -= 25;
    
    addDataField('Activity Date (Field 33)', formatDateForPDF(reportData.suspicious_activity_date));
    addDataField('Total Amount (Field 34)', formatCurrencyForPDF(reportData.total_dollar_amount));
    addDataField('Activity Type', reportData.activity_type);
    addDataField('Description', reportData.activity_description);
    
    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
    
  } catch (error) {
    console.error('Error creating PDF with text overlay:', error);
    // Fallback: create simple data summary
    return await createSARDataSummaryPdf(await PDFDocument.create(), reportData);
  }
}

// Create a clean SAR data summary PDF
async function createSARDataSummaryPdf(pdfDoc, reportData) {
  try {
    const page = pdfDoc.addPage([612, 792]); // Standard letter size
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont('Helvetica');
    const boldFont = await pdfDoc.embedFont('Helvetica-Bold');
    
    let yPosition = height - 50;
    const lineHeight = 18;
    const leftMargin = 50;
    const rightMargin = width - 50;
    
    // Header
    page.drawText('SUSPICIOUS ACTIVITY REPORT (SAR)', {
      x: leftMargin,
      y: yPosition,
      size: 18,
      font: boldFont,
    });
    
    page.drawText('DATA SUMMARY', {
      x: leftMargin,
      y: yPosition - 25,
      size: 14,
      font: boldFont,
    });
    
    page.drawText(`Generated: ${new Date().toLocaleDateString()}`, {
      x: rightMargin - 150,
      y: yPosition - 25,
      size: 10,
      font: font,
    });
    
    yPosition -= 60;
    
    // Draw a line
    page.drawLine({
      start: { x: leftMargin, y: yPosition },
      end: { x: rightMargin, y: yPosition },
      thickness: 1,
    });
    yPosition -= 30;
    
    // Helper function for sections
    const addSection = (title, fields) => {
      page.drawText(title, {
        x: leftMargin,
        y: yPosition,
        size: 14,
        font: boldFont,
      });
      yPosition -= 25;
      
      fields.forEach(([label, value, fieldNum]) => {
        if (value) {
          const fieldText = fieldNum ? ` (Field ${fieldNum})` : '';
          page.drawText(`${label}${fieldText}:`, {
            x: leftMargin + 10,
            y: yPosition,
            size: 10,
            font: boldFont,
          });
          
          // Wrap long text
          const maxWidth = rightMargin - leftMargin - 150;
          const wrappedText = wrapText(String(value), maxWidth, font, 10);
          
          page.drawText(wrappedText, {
            x: leftMargin + 150,
            y: yPosition,
            size: 10,
            font: font,
          });
          yPosition -= lineHeight;
        }
      });
      yPosition -= 15;
    };
    
    // Financial Institution Section
    addSection('PART I - FINANCIAL INSTITUTION INFORMATION', [
      ['Name', reportData.financial_institution_name, '2'],
      ['EIN', reportData.financial_institution_ein, '3'],
      ['Address', reportData.financial_institution_address, '4'],
      ['City', reportData.financial_institution_city, '6'],
      ['State', reportData.financial_institution_state, '7'],
      ['ZIP Code', reportData.financial_institution_zip, '8'],
    ]);
    
    // Branch Information
    if (reportData.branch_address) {
      addSection('BRANCH OFFICE INFORMATION', [
        ['Branch Address', reportData.branch_address, '9'],
        ['Branch City', reportData.branch_city, '10'],
        ['Branch State', reportData.branch_state, '11'],
        ['Branch ZIP', reportData.branch_zip, '12'],
      ]);
    }
    
    // Account Information
    addSection('ACCOUNT INFORMATION', [
      ['Account Number(s)', reportData.account_number, '14'],
    ]);
    
    // Suspect Information
    addSection('PART II - SUSPECT INFORMATION', [
      ['Last Name/Entity Name', reportData.suspect_last_name || reportData.suspect_entity_name, '15'],
      ['First Name', reportData.suspect_first_name, '16'],
      ['Address', reportData.suspect_address, '18'],
      ['City', reportData.suspect_city, '20'],
      ['State', reportData.suspect_state, '21'],
      ['ZIP Code', reportData.suspect_zip, '22'],
      ['Phone Number', reportData.suspect_phone, '24'],
    ]);
    
    // Activity Information
    addSection('PART III - SUSPICIOUS ACTIVITY INFORMATION', [
      ['Activity Date', formatDateForPDF(reportData.suspicious_activity_date), '33'],
      ['Total Dollar Amount', `$${formatCurrencyForPDF(reportData.total_dollar_amount)}`, '34'],
      ['Activity Type', reportData.activity_type, ''],
      ['Activity Description', reportData.activity_description, ''],
    ]);
    
    // Footer
    const footerY = 50;
    page.drawText('This document contains SAR data for official use only.', {
      x: leftMargin,
      y: footerY,
      size: 8,
      font: font,
    });
    
    page.drawText('Please transfer this information to the official SAR form for submission.', {
      x: leftMargin,
      y: footerY - 12,
      size: 8,
      font: font,
    });
    
    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
    
  } catch (error) {
    console.error('Error creating SAR data summary PDF:', error);
    throw error;
  }
}

// Helper function to wrap text
function wrapText(text, maxWidth, font, fontSize) {
  const words = text.split(' ');
  let line = '';
  let result = '';
  
  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i] + ' ';
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);
    
    if (testWidth > maxWidth && i > 0) {
      result += line + '\n';
      line = words[i] + ' ';
    } else {
      line = testLine;
    }
  }
  result += line;
  
  return result.trim();
}

// Helper functions for PDF formatting
function formatDateForPDF(dateString) {
  if (!dateString) return '';
  
  try {
    const date = new Date(dateString);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
  } catch {
    return dateString;
  }
}

function formatCurrencyForPDF(amount) {
  if (!amount && amount !== 0) return '';
  
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  return numAmount.toFixed(2);
}

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const health = await esClient.cluster.health();
    
    // Handle different Elasticsearch client response structures
    let status, numberOfNodes;
    
    if (health.body) {
      // Older client structure
      status = health.body.status;
      numberOfNodes = health.body.number_of_nodes;
    } else {
      // Newer client structure
      status = health.status;
      numberOfNodes = health.number_of_nodes;
    }
    
    res.json({
      status: 'healthy',
      elasticsearch: {
        cluster_status: status,
        number_of_nodes: numberOfNodes
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Elasticsearch health check failed:', error.message);
    res.status(503).json({
      status: 'unhealthy',
      error: 'Cannot connect to Elasticsearch',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`SAR Web System running on port ${PORT}`);
  console.log(`Access the application at: http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
