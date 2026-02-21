# Brightcode IT Employee Management System

A Flask-based web application for managing IT company employee details with MongoDB backend.

## Features

- **Employee Management**: Add, view, update, and delete employee records
- **Dashboard**: Real-time analytics and employee insights
- **Department Metrics**: Aggregate statistics by department
- **CSV Export**: Export employee data to CSV format
- **Responsive Design**: Modern web interface with Bootstrap

## Technology Stack

- **Backend**: Flask 3.0.0
- **Database**: MongoDB with PyMongo 4.6.0
- **Frontend**: HTML, CSS, JavaScript with Bootstrap
- **Data Format**: JSON REST API

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd demo_database
   ```

2. **Create and activate virtual environment**
   ```bash
   python -m venv venv
   # Windows
   venv\Scripts\activate
   # Linux/Mac
   source venv/bin/activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Set up MongoDB**
   - Install MongoDB on your system
   - Start MongoDB service
   - Default connection: `mongodb://localhost:27017/it_company`

5. **Configure environment variables (optional)**
   ```bash
   # Create .env file
   MONGO_URI=mongodb://localhost:27017/it_company
   MONGO_DB_NAME=it_company
   PORT=5000
   ```

## Usage

1. **Run the application**
   ```bash
   python main.py
   ```

2. **Access the application**
   - Open browser to `http://localhost:5000`
   - Default port is 5000, configurable via `PORT` environment variable

## API Endpoints

### Employee Management
- `GET /api/employees` - List all employees
- `POST /api/employees` - Create new employee
- `GET /api/employees/<id>` - Get specific employee
- `PUT /api/employees/<id>` - Update employee
- `DELETE /api/employees/<id>` - Delete employee

### Analytics & Reports
- `GET /api/employees/summary` - Get employee summary statistics
- `GET /api/employees/department-metrics` - Get department-wise metrics
- `GET /api/employees/export` - Export employees as CSV

### Web Pages
- `/` - Dashboard with employee insights
- `/add` - Add new employee form
- `/roster` - Employee roster listing

## Employee Data Model

```json
{
  "full_name": "John Doe",
  "email": "john.doe@company.com",
  "department": "Engineering",
  "designation": "Senior Developer",
  "experience_years": 5.5,
  "salary": 75000,
  "created_at": "2024-01-15T10:30:00Z"
}
```

## Project Structure

```
demo_database/
├── main.py              # Main Flask application
├── requirements.txt     # Python dependencies
├── .gitignore          # Git ignore rules
├── static/             # Static assets (CSS, JS, images)
├── templates/          # HTML templates
│   ├── index.html      # Dashboard page
│   ├── add_employee.html # Add employee form
│   └── roster.html     # Employee roster
└── venv/               # Virtual environment
```

## Development

### Running in Development Mode
```bash
python main.py
```
The application runs in debug mode by default.

### Environment Variables
- `MONGO_URI`: MongoDB connection string
- `MONGO_DB_NAME`: Database name
- `PORT`: Application port (default: 5000)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For issues and questions, please create an issue in the repository.
