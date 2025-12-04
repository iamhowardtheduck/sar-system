# SAR Management System

A professional web-based Suspicious Activity Report (SAR) management system that displays and manages SAR data from Elasticsearch with a compliance-focused interface.

## 🌟 Features

- **Professional Web Interface** - Clean, trustworthy design suitable for financial compliance
- **Elasticsearch Integration** - Real-time data retrieval with full-text search capabilities
- **SAR Field Mapping** - Direct mapping to official SAR PDF template fields (2, 3, 4, 6-12, 14-16, 18, 20-22, 24, 33-34)
- **Advanced Search & Filter** - Search across multiple fields with pagination
- **Responsive Design** - Works seamlessly on desktop and mobile devices
- **Security Features** - Rate limiting, CORS protection, input sanitization
- **Health Monitoring** - Real-time system status and connectivity checks
- **RESTful API** - Complete API for integration with other systems

## 📋 SAR PDF Field Mapping

The system automatically maps Elasticsearch data to these official SAR template fields:

### Financial Institution Information
- **Field 2**: `financial_institution_name` - Name of Financial Institution
- **Field 3**: `financial_institution_ein` - EIN
- **Field 4**: `financial_institution_address` - Address of Financial Institution
- **Fields 6-8**: `financial_institution_city`, `financial_institution_state`, `financial_institution_zip`

### Branch Office Information
- **Fields 9-12**: `branch_address`, `branch_city`, `branch_state`, `branch_zip`

### Account & Suspect Information
- **Field 14**: `account_number` - Account number(s) affected
- **Fields 15-16**: `suspect_last_name`/`suspect_entity_name`, `suspect_first_name`
- **Fields 18, 20-22, 24**: Address, city, state, zip, phone information

### Activity Information
- **Field 33**: `suspicious_activity_date` - Date or date range of suspicious activity
- **Field 34**: `total_dollar_amount` - Total dollar amount involved

## 🚀 Quick Start

### Prerequisites

- Node.js 16+ and npm
- Elasticsearch cluster with SAR data
- Linux/macOS (Ubuntu 18.04+ recommended)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/sar-management-system.git
   cd sar-management-system
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your Elasticsearch settings
   ```

4. **Set up Elasticsearch index:**
   ```bash
   # Create index with proper mapping
   curl -X PUT "http://kubernetes-vm:30920/sar-reports" \
     -H "Content-Type: application/json" \
     -d @elasticsearch-mapping.json \
     -u "fraud:hunter"
   ```

5. **Load sample data (optional):**
   ```bash
   ./load-sample-data.sh
   ```

6. **Start the application:**
   ```bash
   npm start
   ```

7. **Access the interface:**
   Open `http://localhost:3000`

### Automated Installation

For automated setup:

```bash
chmod +x install_sar_system.sh
./install_sar_system.sh --sample-data
```

## ⚙️ Configuration

Create a `.env` file with your configuration:

```bash
# Server Configuration
PORT=3000
NODE_ENV=production

# Elasticsearch Configuration
ELASTICSEARCH_URL=https://your-elasticsearch-cluster:9200
ELASTICSEARCH_USERNAME=your-username
ELASTICSEARCH_PASSWORD=your-password
ELASTICSEARCH_INDEX=sar-reports

# Security
SESSION_SECRET=your-secure-random-string
```

## 📡 API Endpoints

- `GET /api/sar-reports` - List SAR reports with pagination and search
- `GET /api/sar-reports/:id` - Get specific SAR report details
- `GET /api/health` - System health check

### Example API Usage

```bash
# Get all reports
curl http://localhost:3000/api/sar-reports

# Search for reports
curl "http://localhost:3000/api/sar-reports?search=smith&page=1&size=10"

# Check system health
curl http://localhost:3000/api/health
```

## 🔒 Security Features

- **Rate Limiting** - API endpoint protection
- **Input Sanitization** - XSS and injection prevention
- **CORS Protection** - Cross-origin request security
- **Helmet.js** - Security headers
- **Environment Variables** - Secure credential management

## 📊 Sample Data Structure

```json
{
  "@timestamp": "2024-01-15T10:30:00Z",
  "financial_institution_name": "Example Bank",
  "financial_institution_ein": "12-3456789",
  "suspect_last_name": "Smith",
  "suspect_first_name": "John",
  "suspicious_activity_date": "2024-01-10",
  "total_dollar_amount": 50000.00,
  "activity_description": "Structured transactions to avoid reporting requirements"
}
```

## 🏗️ Architecture

```
├── server.js              # Express.js server
├── public/                # Static assets
│   ├── css/styles.css     # Application styling
│   └── js/app.js          # Frontend JavaScript
├── views/                 # EJS templates
├── elasticsearch-mapping.json  # ES index mapping
└── sample-sar-data.json   # Sample data for testing
```

## 🛠️ Development

```bash
# Development mode with auto-restart
npm run dev

# Production mode
npm start

# Install new dependencies
npm install package-name
```

## 🔧 Troubleshooting

**Cannot connect to Elasticsearch:**
- Verify ELASTICSEARCH_URL in .env
- Check credentials and network connectivity
- Test connection: `curl -u user:pass http://your-es:9200/_cluster/health`

**No reports showing:**
- Verify index name matches ELASTICSEARCH_INDEX
- Check if data exists in Elasticsearch
- Review mapping compatibility

**System health shows errors:**
- Check Elasticsearch cluster status
- Verify index exists and is accessible
- Review application logs

## 📜 License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📞 Support

- Create an [Issue](https://github.com/yourusername/sar-management-system/issues) for bug reports or feature requests
- See [WORKSHOP.md](WORKSHOP.md) for workshop-specific setup instructions

## ⚠️ Security Notice

This system handles sensitive financial data. Always follow your organization's security policies and regulatory requirements when deploying to production environments.

---

**Note**: This system is designed for legitimate compliance and regulatory purposes only. Ensure proper authorization and adherence to all applicable laws and regulations when handling suspicious activity data.


# FinCEN Form 8300 XML Generation

## Overview

The SAR Management System now includes **FinCEN Form 8300 XML generation** for cash transactions over $10,000. This feature creates XML files that comply with the official FinCEN 8300X schema for electronic filing.

## ✨ Features Added

- **📋 Generate 8300 XML Button**: Added to every SAR report card and modal
- **🏛️ Official Compliance**: Follows FinCEN EFL_8300XBatchSchema.xsd exactly
- **📊 Automatic Mapping**: Maps SAR data to Form 8300 requirements
- **💾 XML Download**: Generates downloadable XML files for BSA E-Filing
- **🔄 Multi-Party Support**: Includes all required parties (minimum 4)

## 🏢 FinCEN Form 8300 Purpose

**Form 8300** is required for:
- Cash payments over $10,000 received in trade or business
- Related transactions totaling over $10,000 within 12 months
- Suspicious cash transactions (from SAR data)

## 📋 XML Schema Compliance

### Based on Official FinCEN Schema:
- **Schema**: `EFL_8300XBatchSchema.xsd` 
- **Namespace**: `www.fincen.gov/base`
- **Form Type**: `8300X` (XML Batch Format)
- **Version**: BSA XML 2.0

### Required Elements Included:
- `EFilingBatchXML` with TotalAmount, PartyCount, ActivityCount
- `Activity` with filing details and transaction information
- `Party` elements (minimum 4):
  1. **Business that received cash** (Code 4)
  2. **Individual from whom cash received** (Code 16) 
  3. **Transmitter** (Code 35)
  4. **Contact for assistance** (Code 8)
- `CurrencyTransactionActivity` with transaction details
- `ActivityNarrativeInformation` with description

## 🗺️ Data Mapping

### SAR Data → Form 8300 Fields

| SAR Field | Form 8300 Element | Party Type | Purpose |
|-----------|-------------------|------------|----------|
| `financial_institution_name` | Business name | Receiving Business (4) | Organization that received cash |
| `financial_institution_address` | Business address | Receiving Business (4) | Business location |
| `financial_institution_ein` | EIN | Receiving Business (4) | Business tax ID |
| `suspect_last_name` | Individual last name | Cash Provider (16) | Person providing cash |
| `suspect_first_name` | Individual first name | Cash Provider (16) | Person providing cash |
| `suspect_address` | Individual address | Cash Provider (16) | Person's address |
| `suspect_phone` | Phone number | Cash Provider (16) | Contact information |
| `total_dollar_amount` | Transaction amount | Currency Activity | Cash amount received |
| `suspicious_activity_date` | Transaction date | Currency Activity | When transaction occurred |
| `activity_description` | Narrative text | Activity Narrative | Transaction description |

### Required Parties Generated:

1. **Receiving Business (Party Type 4)**
   - Uses financial institution data from SAR
   - Required for business that received the cash

2. **Cash Provider (Party Type 16)** 
   - Uses suspect information from SAR
   - Individual who provided the cash payment

3. **Transmitter (Party Type 35)**
   - Filing institution (same as receiving business)
   - Required for electronic filing identification

4. **Contact Person (Party Type 8)**
   - Compliance officer contact information
   - Required for follow-up questions

## 🚀 Usage

### From Report Cards:
1. Browse SAR reports on main dashboard
2. Click **"📋 Generate 8300 XML"** button on any report
3. XML file downloads automatically

### From Detail Modal:
1. Click "📄 View Details" on any report
2. In modal, click **"📋 Generate 8300 XML"** 
3. XML file downloads automatically

### Generated Files:
- **Format**: `FinCEN-8300-{ReportID}-{Date}.xml`
- **Content**: Valid FinCEN 8300X XML ready for BSA E-Filing
- **Location**: Downloads to browser's default download folder

## 📊 Example XML Structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<EFilingBatchXML xmlns="www.fincen.gov/base" 
                 TotalAmount="15000" 
                 PartyCount="4" 
                 ActivityCount="1">
  <FormTypeCode>8300X</FormTypeCode>
  <Activity SeqNum="1">
    <FilingDateText>20241203</FilingDateText>
    <SuspiciousTransactionIndicator>Y</SuspiciousTransactionIndicator>
    <ActivityAssociation SeqNum="2">
      <InitialReportIndicator>Y</InitialReportIndicator>
    </ActivityAssociation>
    
    <!-- Business that received cash -->
    <Party SeqNum="3">
      <ActivityPartyTypeCode>4</ActivityPartyTypeCode>
      <PartyTypeCode>O</PartyTypeCode>
      <PartyName SeqNum="4">
        <PartyNameTypeCode>L</PartyNameTypeCode>
        <RawPartyFullName>First National Bank</RawPartyFullName>
      </PartyName>
      <!-- Address, EIN, etc. -->
    </Party>
    
    <!-- Individual from whom cash received -->
    <Party SeqNum="8">
      <ActivityPartyTypeCode>16</ActivityPartyTypeCode>
      <PartyTypeCode>I</PartyTypeCode>
      <!-- Individual details -->
    </Party>
    
    <!-- Currency Transaction Activity -->
    <CurrencyTransactionActivity SeqNum="15">
      <TotalCashInReceiveAmountText>15000</TotalCashInReceiveAmountText>
      <TransactionDateText>20241203</TransactionDateText>
      <!-- Transaction details -->
    </CurrencyTransactionActivity>
  </Activity>
</EFilingBatchXML>
```

## 🔧 Technical Implementation

### Backend (server.js):
- **Endpoint**: `GET /api/sar-reports/:id/fincen8300`
- **Function**: `generateFinCEN8300XML(reportData, reportId)`
- **Library**: `xmlbuilder2` for XML generation
- **Validation**: Schema-compliant structure with sequence numbers

### Frontend (app.js):
- **Function**: `generateFinCEN8300(reportId, buttonElement)`
- **UI**: Loading states, success/error feedback
- **Download**: Automatic XML file download

### Dependencies Added:
```json
"xmlbuilder2": "^3.1.1"
```

## 🛡️ Compliance Features

### FinCEN Requirements Met:
- ✅ **Schema Validation**: Follows official XSD exactly
- ✅ **Required Parties**: Minimum 4 parties with correct codes
- ✅ **Sequence Numbers**: Unique SeqNum for all elements
- ✅ **Data Validation**: Text length limits, date formats
- ✅ **XML Encoding**: Proper character escaping and encoding
- ✅ **Narrative Information**: Transaction description included

### Data Security:
- ✅ **No External Calls**: XML generated server-side only
- ✅ **Data Privacy**: Sensitive fields (SSN) left empty for privacy
- ✅ **Character Cleaning**: Removes invalid XML characters
- ✅ **Length Validation**: Enforces FinCEN field length limits

## 📋 Validation & Testing

### To Test XML Generation:

1. **Install Dependencies**:
   ```bash
   npm install xmlbuilder2
   ```

2. **Start Application**:
   ```bash
   npm start
   ```

3. **Generate XML**:
   - Click "📋 Generate 8300 XML" on any SAR report
   - XML file should download automatically

4. **Validate XML**:
   - Check file opens without errors
   - Verify proper FinCEN 8300X structure
   - Confirm all required parties present

### Expected XML File:
- **Valid XML**: Well-formed and parseable
- **Schema Compliant**: Follows FinCEN 8300X schema exactly
- **Complete Data**: All required elements populated
- **Ready for Filing**: Can be submitted to BSA E-Filing

## 🎯 Business Use Cases

### When to Generate Form 8300:
1. **Cash Over $10,000**: When SAR involves cash transactions above threshold
2. **Related Transactions**: Multiple smaller cash transactions from same person
3. **Suspicious Cash Activity**: When cash patterns indicate potential issues
4. **Compliance Reporting**: Dual SAR/8300 filing requirements

### Compliance Workflow:
1. **Identify**: SAR with cash transaction over $10,000
2. **Generate**: Click "Generate 8300 XML" button  
3. **Review**: Verify XML contains correct information
4. **File**: Submit XML through BSA E-Filing portal
5. **Track**: Maintain records per regulatory requirements

## 🔮 Future Enhancements

Potential additional features:
- **Batch Generation**: Create 8300 XML for multiple reports
- **Template Customization**: Custom party information templates
- **Validation Preview**: Pre-submission XML validation
- **Filing Integration**: Direct BSA E-Filing portal integration
- **Threshold Detection**: Automatic 8300 requirement identification

---

## 📞 Support

The FinCEN 8300 XML generation feature is now fully integrated into your SAR Management System. Generated XML files are ready for submission through the official BSA E-Filing portal.

**Key Benefits**:
- ✅ **Automated Compliance**: Convert SAR data to Form 8300 instantly
- ✅ **Error Prevention**: Schema-validated XML prevents filing errors  
- ✅ **Time Savings**: No manual form entry required
- ✅ **Audit Trail**: Downloadable XML files for compliance records
