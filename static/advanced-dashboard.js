// Advanced Dashboard JavaScript
class AdvancedDashboard {
    constructor() {
        this.charts = {};
        this.data = {
            quickStats: null,
            events: null,
            activity: null,
            departmentMetrics: null,
            salaryTrends: null
        };
        this.currentEventTab = 'birthdays';
        this.currentChartView = 'headcount';
        
        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.loadAllData();
        this.renderCharts();
        this.startAutoRefresh();
    }

    setupEventListeners() {
        // Event tabs
        document.querySelectorAll('.event-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.switchEventTab(e.target.dataset.tab);
            });
        });

        // Chart filters
        document.querySelectorAll('.chart-filter').forEach(filter => {
            filter.addEventListener('click', (e) => {
                this.switchChartView(e.target.dataset.chart);
            });
        });

        // Refresh activity button
        const refreshBtn = document.getElementById('refresh-activity');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.loadActivityFeed();
            });
        }
    }

    switchEventTab(tabName) {
        // Update active tab
        document.querySelectorAll('.event-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Show corresponding content
        document.querySelectorAll('.event-content').forEach(content => {
            content.classList.add('hidden');
        });
        document.getElementById(`${tabName}-content`).classList.remove('hidden');

        this.currentEventTab = tabName;
    }

    switchChartView(view) {
        // Update active filter
        document.querySelectorAll('.chart-filter').forEach(filter => {
            filter.classList.remove('active');
        });
        document.querySelector(`[data-chart="${view}"]`).classList.add('active');

        this.currentChartView = view;
        this.updateDepartmentChart();
    }

    async loadAllData() {
        try {
            const [quickStats, events, activity, departmentMetrics, salaryTrends] = await Promise.all([
                this.fetchQuickStats(),
                this.fetchUpcomingEvents(),
                this.fetchActivityFeed(),
                this.fetchDepartmentMetrics(),
                this.fetchSalaryTrends()
            ]);

            this.data.quickStats = quickStats;
            this.data.events = events;
            this.data.activity = activity;
            this.data.departmentMetrics = departmentMetrics;
            this.data.salaryTrends = salaryTrends;

            this.renderQuickStats();
            this.renderEvents();
            this.renderActivity();
            this.renderDepartmentGrowth();
        } catch (error) {
            console.error('Error loading dashboard data:', error);
            this.showError('Failed to load dashboard data');
        }
    }

    async fetchQuickStats() {
        const response = await fetch('/api/dashboard/quick-stats');
        if (!response.ok) throw new Error('Failed to fetch quick stats');
        return await response.json();
    }

    async fetchUpcomingEvents() {
        const response = await fetch('/api/dashboard/upcoming-events');
        if (!response.ok) throw new Error('Failed to fetch upcoming events');
        return await response.json();
    }

    async fetchActivityFeed() {
        const response = await fetch('/api/dashboard/activity-feed');
        if (!response.ok) throw new Error('Failed to fetch activity feed');
        return await response.json();
    }

    async fetchDepartmentMetrics() {
        const response = await fetch('/api/employees/department-metrics');
        if (!response.ok) throw new Error('Failed to fetch department metrics');
        const data = await response.json();
        return data.departments || [];
    }

    async fetchSalaryTrends() {
        const response = await fetch('/api/dashboard/salary-trends');
        if (!response.ok) throw new Error('Failed to fetch salary trends');
        const data = await response.json();
        return data.trends || [];
    }

    renderQuickStats() {
        const stats = this.data.quickStats;
        if (!stats) return;

        // Update quick stats cards
        this.updateElement('new-hires-month', stats.new_hires_this_month || 0);
        this.updateElement('turnover-rate', `${stats.turnover_rate || 0}%`);
        
        // Calculate trend
        const trend = stats.new_hires_this_month - stats.new_hires_last_month;
        const trendElement = document.getElementById('hires-trend');
        if (trendElement) {
            const trendText = trend > 0 ? `+${trend} from last month` : 
                             trend < 0 ? `${trend} from last month` : 
                             'Same as last month';
            trendElement.textContent = trendText;
            trendElement.className = `metric-card__trend ${trend > 0 ? 'positive' : trend < 0 ? 'negative' : 'neutral'}`;
        }

        // Get total employees and average salary from summary
        this.loadSummaryStats();
    }

    async loadSummaryStats() {
        try {
            const response = await fetch('/api/employees/summary');
            const summary = await response.json();
            
            this.updateElement('total-employees', summary.total_employees || 0);
            this.updateElement('avg-salary', this.formatCurrency(summary.average_salary || 0));
        } catch (error) {
            console.error('Error loading summary stats:', error);
        }
    }

    renderEvents() {
        const events = this.data.events;
        if (!events) return;

        // Render birthdays
        this.renderEventList('birthdays-content', events.birthdays || [], 'birthday-template', 
            (event) => ({
                name: event.employee_name,
                date: this.formatDate(event.date),
                age: event.age,
                days: event.days_until
            }));

        // Render anniversaries
        this.renderEventList('anniversaries-content', events.anniversaries || [], 'anniversary-template',
            (event) => ({
                name: event.employee_name,
                date: this.formatDate(event.date),
                years: event.years_of_service,
                days: event.days_until
            }));

        // Render probation end dates
        this.renderEventList('probation-content', events.probation_end || [], 'probation-template',
            (event) => ({
                name: event.employee_name,
                date: this.formatDate(event.date),
                days: event.days_until
            }));
    }

    renderEventList(containerId, events, templateId, mapper) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (events.length === 0) {
            container.innerHTML = '<p class="muted">No upcoming events.</p>';
            return;
        }

        const template = document.getElementById(templateId);
        if (!template) return;

        container.innerHTML = events.map(event => {
            const data = mapper(event);
            let html = template.innerHTML;
            
            Object.keys(data).forEach(key => {
                html = html.replace(new RegExp(`{{${key}}}`, 'g'), data[key]);
            });
            
            return html;
        }).join('');
    }

    renderActivity() {
        const activityData = this.data.activity;
        if (!activityData || !activityData.activities) return;

        const container = document.getElementById('activity-list');
        if (!container) return;

        const template = document.getElementById('activity-template');
        if (!template) return;

        if (activityData.activities.length === 0) {
            container.innerHTML = '<p class="muted">No recent activity.</p>';
            return;
        }

        container.innerHTML = activityData.activities.map(activity => {
            let html = template.innerHTML;
            html = html.replace('{{description}}', activity.description);
            html = html.replace('{{timestamp}}', activity.timestamp);
            html = html.replace('{{time}}', this.formatDateTime(activity.timestamp));
            return html;
        }).join('');
    }

    renderDepartmentGrowth() {
        const stats = this.data.quickStats;
        if (!stats || !stats.department_growth) return;

        const container = document.getElementById('growth-list');
        if (!container) return;

        const template = document.getElementById('growth-template');
        if (!template) return;

        if (stats.department_growth.length === 0) {
            container.innerHTML = '<p class="muted">No growth data available.</p>';
            return;
        }

        container.innerHTML = stats.department_growth.map(dept => {
            let html = template.innerHTML;
            html = html.replace('{{department}}', dept.department);
            html = html.replace('{{new_hires}}', dept.new_hires);
            html = html.replace('{{percentage}}', dept.growth_percentage.toFixed(1));
            html = html.replace('{{total}}', dept.total);
            return html;
        }).join('');
    }

    renderCharts() {
        this.renderDepartmentChart();
        this.renderSalaryTrendsChart();
    }

    renderDepartmentChart() {
        const ctx = document.getElementById('department-chart');
        if (!ctx || !this.data.departmentMetrics) return;

        const metrics = this.data.departmentMetrics;
        const labels = metrics.map(m => m.department || 'Unknown');
        
        let data, label, backgroundColor;
        
        if (this.currentChartView === 'headcount') {
            data = metrics.map(m => m.headcount || 0);
            label = 'Headcount';
            backgroundColor = 'rgba(59, 130, 246, 0.6)';
        } else {
            data = metrics.map(m => m.avg_salary || 0);
            label = 'Average Salary';
            backgroundColor = 'rgba(16, 185, 129, 0.6)';
        }

        if (this.charts.department) {
            this.charts.department.destroy();
        }

        this.charts.department = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: label,
                    data: data,
                    backgroundColor: backgroundColor,
                    borderColor: backgroundColor.replace('0.6', '1'),
                    borderWidth: 2,
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: this.currentChartView === 'salary' ? 
                                value => this.formatCurrency(value) : 
                                value => Math.round(value)
                        }
                    }
                }
            }
        });
    }

    updateDepartmentChart() {
        this.renderDepartmentChart();
    }

    renderSalaryTrendsChart() {
        const ctx = document.getElementById('salary-trends-chart');
        if (!ctx || !this.data.salaryTrends) return;

        const trends = this.data.salaryTrends;
        const labels = trends.map(t => t.department || 'Unknown');
        const avgSalaries = trends.map(t => t.avg_salary || 0);
        const minSalaries = trends.map(t => t.min_salary || 0);
        const maxSalaries = trends.map(t => t.max_salary || 0);

        if (this.charts.salaryTrends) {
            this.charts.salaryTrends.destroy();
        }

        this.charts.salaryTrends = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Average Salary',
                        data: avgSalaries,
                        borderColor: 'rgba(59, 130, 246, 1)',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        tension: 0.4,
                        fill: true
                    },
                    {
                        label: 'Min Salary',
                        data: minSalaries,
                        borderColor: 'rgba(16, 185, 129, 1)',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        tension: 0.4,
                        fill: true
                    },
                    {
                        label: 'Max Salary',
                        data: maxSalaries,
                        borderColor: 'rgba(239, 68, 68, 1)',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        tension: 0.4,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top'
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                return `${context.dataset.label}: ${this.formatCurrency(context.parsed.y)}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: value => this.formatCurrency(value)
                        }
                    }
                }
            }
        });
    }

    async loadActivityFeed() {
        try {
            const refreshBtn = document.getElementById('refresh-activity');
            if (refreshBtn) {
                refreshBtn.disabled = true;
                refreshBtn.textContent = '⏳ Loading...';
            }

            this.data.activity = await this.fetchActivityFeed();
            this.renderActivity();

            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.textContent = '🔄 Refresh';
            }
        } catch (error) {
            console.error('Error refreshing activity feed:', error);
            this.showError('Failed to refresh activity feed');
        }
    }

    startAutoRefresh() {
        // Auto-refresh every 5 minutes
        setInterval(async () => {
            await this.loadAllData();
        }, 5 * 60 * 1000);
    }

    updateElement(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    }

    formatCurrency(value) {
        if (!value) return '₹0';
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0
        }).format(value);
    }

    formatDate(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    }

    formatDateTime(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    showError(message) {
        // Create toast notification
        const toast = document.createElement('div');
        toast.className = 'toast toast--error';
        toast.textContent = message;
        toast.style.position = 'fixed';
        toast.style.top = '20px';
        toast.style.right = '20px';
        toast.style.zIndex = '1000';
        toast.style.padding = '12px 20px';
        toast.style.backgroundColor = '#ef4444';
        toast.style.color = 'white';
        toast.style.borderRadius = '8px';
        toast.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 5000);
    }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AdvancedDashboard();
});
