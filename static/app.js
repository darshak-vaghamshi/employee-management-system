const form = document.getElementById("employee-form");
const tableBody = document.getElementById("employee-rows");
const formFeedback = document.getElementById("form-feedback");
const rosterFeedback = document.getElementById("roster-feedback");
const editModal = document.getElementById("edit-modal");
const editForm = document.getElementById("edit-form");
const editFeedback = document.getElementById("edit-feedback");
const searchInput = document.getElementById("roster-search");
const departmentFilter = document.getElementById("department-filter");
const exportButton = document.getElementById("export-button");
const activeFilters = document.getElementById("active-filters");
const deleteModal = document.getElementById("delete-modal");
const deleteConfirm = document.getElementById("delete-confirm");
const deleteMessage = document.getElementById("delete-message");
const toastContainer = document.getElementById("toast-container");
const summaryScript = document.getElementById("initial-summary");
const departmentMetricsScript = document.getElementById("initial-department-metrics");
const departmentHeadcountCanvas = document.getElementById("department-headcount-chart");
const departmentSalaryCanvas = document.getElementById("department-salary-chart");

let activeEmployeeId = null;

const parseInitialData = (scriptTag) => {
    if (!scriptTag) return null;
    try {
        return JSON.parse(scriptTag.textContent || "{}");
    } catch (error) {
        console.error("Failed to parse initial data", error);
        return null;
    }
};

const state = {
    employees: [],
    filters: {
        search: "",
        searchRaw: "",
        department: "",
    },
    summary: parseInitialData(summaryScript) || {},
    departmentMetrics: parseInitialData(departmentMetricsScript) || [],
    charts: {
        headcount: null,
        salary: null,
    },
    pendingDelete: null,
};

const toastTimers = new WeakMap();

const integerFormatter = new Intl.NumberFormat("en-IN");

const cssEscape = (value) => {
    if (typeof value !== "string") return "";
    if (window.CSS && typeof window.CSS.escape === "function") {
        return window.CSS.escape(value);
    }
    return value.replace(/[^a-zA-Z0-9_\-]/g, "\\$&");
};

const createToast = (message, type = "success", duration = 3000) => {
    if (!toastContainer) {
        console.warn("Toast container not found");
        return;
    }

    const toast = document.createElement("div");
    toast.className = `toast toast--${type}`;
    toast.setAttribute("role", "status");
    toast.textContent = message;
    toastContainer.appendChild(toast);

    if (duration > 0) {
        const timer = setTimeout(() => {
            toast.remove();
            toastTimers.delete(toast);
        }, duration);
        toastTimers.set(toast, timer);
    }
};

const getFieldWrapper = (formElement, fieldName) => {
    const escaped = cssEscape(fieldName);
    return formElement
        ?.querySelector(`[data-field] [name="${escaped}"]`)
        ?.closest("[data-field]");
};

const setFieldError = (fieldWrapper, message) => {
    if (!fieldWrapper) return;
    fieldWrapper.classList.toggle("has-error", Boolean(message));
    const errorNode = fieldWrapper.querySelector(".field__error");
    if (errorNode) {
        errorNode.textContent = message || "";
    }
};

const clearFieldErrors = (formElement) => {
    if (!formElement) return;
    formElement.querySelectorAll("[data-field]").forEach((wrapper) => {
        setFieldError(wrapper, "");
    });
};

const validateAndBuildPayload = (formElement) => {
    const formData = new FormData(formElement);
    const payload = {};

    formData.forEach((value, key) => {
        if (typeof value === "string") {
            payload[key] = value.trim();
        } else {
            payload[key] = value;
        }
    });

    let isValid = true;

    const requireField = (field, message) => {
        const wrapper = getFieldWrapper(formElement, field);
        if (!payload[field]) {
            setFieldError(wrapper, message);
            isValid = false;
        } else {
            setFieldError(wrapper, "");
        }
    };

    clearFieldErrors(formElement);

    requireField("full_name", "Full name is required.");
    requireField("email", "Corporate email is required.");
    requireField("department", "Department is required.");
    requireField("designation", "Designation is required.");
    requireField("dob", "Date of birth is required.");
    requireField("hire_date", "Hire date is required.");

    const emailWrapper = getFieldWrapper(formElement, "email");
    if (payload.email) {
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(payload.email)) {
            setFieldError(emailWrapper, "Enter a valid corporate email.");
            isValid = false;
        }
    }

    ["experience_years", "salary"].forEach((field) => {
        const wrapper = getFieldWrapper(formElement, field);
        if (payload[field] === "" || payload[field] === undefined) {
            payload[field] = null;
            setFieldError(wrapper, "");
            return;
        }

        const numericValue = Number(payload[field]);
        if (Number.isNaN(numericValue) || numericValue < 0) {
            setFieldError(wrapper, `${field === "salary" ? "Salary" : "Experience"} must be a positive number.`);
            isValid = false;
        } else {
            payload[field] = numericValue;
            setFieldError(wrapper, "");
        }
    });

    if (payload.email) {
        payload.email = payload.email.toLowerCase();
    }

    return { payload, isValid };
};

const updateSummaryCards = () => {
    if (!state.summary || typeof state.summary !== "object") return;

    const topDepartment = state.summary?.top_department || null;

    document.querySelectorAll("[data-summary]").forEach((node) => {
        const key = node.dataset.summary;
        const format = node.dataset.format;
        let text = "—";

        switch (key) {
            case "average_salary": {
                const value = state.summary?.average_salary;
                text = value !== null && value !== undefined ? formatCurrency(value) : "—";
                break;
            }
            case "average_experience": {
                const value = state.summary?.average_experience;
                text = value !== null && value !== undefined ? formatExperience(value) : "—";
                break;
            }
            case "top_department": {
                text = topDepartment?.department || "—";
                break;
            }
            case "total_employees": {
                const value = state.summary?.total_employees;
                text = typeof value === "number" ? integerFormatter.format(value) : "0";
                break;
            }
            default: {
                const value = state.summary ? state.summary[key] : null;
                if (value !== null && value !== undefined && value !== "") {
                    text = format === "currency" ? formatCurrency(value) : String(value);
                }
            }
        }

        node.textContent = text;
    });

    document.querySelectorAll("[data-summary-hint]").forEach((node) => {
        const key = node.dataset.summaryHint;
        let text = "";

        if (key === "top_department_headcount") {
            text = topDepartment?.headcount
                ? `${integerFormatter.format(topDepartment.headcount)} teammates`
                : "";
        }

        node.textContent = text;
        node.hidden = !text;
    });
};

const renderDepartmentCharts = () => {
    if (!window.Chart) return;
    const metrics = Array.isArray(state.departmentMetrics)
        ? state.departmentMetrics
        : [];

    const labels = metrics.map((metric) => metric.department || "Unknown");
    const headcount = metrics.map((metric) => metric.headcount || 0);
    const avgSalary = metrics.map((metric) => metric.avg_salary || 0);

    if (departmentHeadcountCanvas) {
        if (state.charts.headcount) {
            state.charts.headcount.data.labels = labels;
            state.charts.headcount.data.datasets[0].data = headcount;
            state.charts.headcount.update();
        } else {
            state.charts.headcount = new Chart(departmentHeadcountCanvas, {
                type: "bar",
                data: {
                    labels,
                    datasets: [
                        {
                            label: "Headcount",
                            data: headcount,
                            backgroundColor: ["#110b3d", "#6a4d8b", "#114b5f", "#474973", "#8b7aa8", "#4d4c46"],
                            borderRadius: 8,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    scales: {
                        y: {
                            ticks: {
                                precision: 0,
                            },
                            beginAtZero: true,
                        },
                    },
                },
            });
        }
    }

    if (departmentSalaryCanvas) {
        if (state.charts.salary) {
            state.charts.salary.data.labels = labels;
            state.charts.salary.data.datasets[0].data = avgSalary;
            state.charts.salary.update();
        } else {
            state.charts.salary = new Chart(departmentSalaryCanvas, {
                type: "line",
                data: {
                    labels,
                    datasets: [
                        {
                            label: "Average salary (₹)",
                            data: avgSalary,
                            borderColor: ["#110b3d", "#6a4d8b", "#114b5f", "#474973", "#8b7aa8", "#4d4c46"],
                            backgroundColor: 'rgba(125, 79, 80, 0.1)',
                            borderWidth: 3,
                            tension: 0.3,
                            fill: true,
                            pointBackgroundColor: ["#110b3d", "#6a4d8b", "#114b5f", "#474973", "#8b7aa8", "#4d4c46"],
                            pointBorderColor: '#fff',
                            pointBorderWidth: 2,
                            pointRadius: 6,
                            pointHoverRadius: 8
                        },
                    ],
                },
                options: {
                    responsive: true,
                    plugins: {
                        tooltip: {
                            callbacks: {
                                label: (context) =>
                                    `${context.dataset.label}: ${formatCurrency(context.parsed.y)}`,
                            },
                        },
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                        },
                    },
                },
            });
        }
    }
};

const refreshSummary = async () => {
    if (!document.querySelector("[data-summary]")) return;
    try {
        const response = await fetch("/api/employees/summary");
        if (!response.ok) throw new Error("Unable to fetch summary metrics");
        state.summary = await response.json();
        updateSummaryCards();
    } catch (error) {
        console.error(error);
        const message = error.message.includes('fetch') ? "Unable to fetch summary metrics. Please check your connection." : error.message;
        createToast(message, "error", 4000);
    }
};

const refreshDepartmentMetrics = async () => {
    if (!departmentHeadcountCanvas && !departmentSalaryCanvas) return;
    try {
        const response = await fetch("/api/employees/department-metrics");
        if (!response.ok) throw new Error("Unable to fetch department metrics");
        const { departments } = await response.json();
        state.departmentMetrics = departments || [];
        renderDepartmentCharts();
    } catch (error) {
        console.error(error);
        const message = error.message.includes('fetch') ? "Unable to fetch department metrics. Please check your connection." : error.message;
        createToast(message, "error", 4000);
    }
};

const refreshAnalytics = async () => {
    await Promise.all([refreshSummary(), refreshDepartmentMetrics()]);
};

const updateActiveFilters = () => {
    if (!activeFilters) return;
    const parts = [];

    if (state.filters.searchRaw) {
        parts.push(`Search: "${state.filters.searchRaw}"`);
    }
    if (state.filters.department) {
        parts.push(`Department: ${state.filters.department}`);
    }

    activeFilters.textContent = parts.join(" · ");
    activeFilters.hidden = parts.length === 0;
};

const applyFilters = (employees) => {
    if (!Array.isArray(employees)) return [];
    const search = state.filters.search;
    const department = state.filters.department;

    return employees.filter((employee) => {
        const matchesDepartment = !department || employee.department === department;
        const matchesSearch = !search
            || [employee.full_name, employee.email, employee.designation]
                .filter(Boolean)
                .some((value) => value.toLowerCase().includes(search));
        return matchesDepartment && matchesSearch;
    });
};

const renderEmployees = () => {
    if (!tableBody) return;
    const filtered = applyFilters(state.employees);
    tableBody.innerHTML = "";

    if (filtered.length === 0) {
        const emptyRow = document.createElement("tr");
        emptyRow.innerHTML =
            '<td class="table__empty" colspan="9">No employees match the current filters.</td>';
        tableBody.appendChild(emptyRow);
    } else {
        filtered.forEach((employee) => {
            tableBody.appendChild(buildRow(employee));
        });
    }

    if (rosterFeedback) {
        setFeedback(rosterFeedback, "", "success");
        rosterFeedback.hidden = true;
    }
    updateActiveFilters();
};

const upsertEmployee = (employee) => {
    if (!employee) return;
    const index = state.employees.findIndex((item) => item.id === employee.id);
    if (index >= 0) {
        state.employees[index] = employee;
    } else {
        state.employees.unshift(employee);
    }
};

const removeEmployeeFromState = (employeeId) => {
    state.employees = state.employees.filter((employee) => employee.id !== employeeId);
};

const formatCurrency = (value) => {
    if (value === null || value === undefined || value === "") return "—";
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
    }).format(value);
};

const formatExperience = (value) => {
    if (value === null || value === undefined || value === "") return "—";
    const rounded = Math.round(value * 10) / 10;
    return `${rounded} yrs`;
};

const formatDate = (iso) => {
    if (!iso) return "—";
    const date = new Date(iso);
    return date.toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
    });
};

const formatDateOnly = (iso) => {
    if (!iso) return "—";
    const date = new Date(iso);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
};

const buildRow = (employee) => {
    const tr = document.createElement("tr");
    tr.dataset.employeeId = employee.id;
    tr.innerHTML = `
    <td>
      <div class="name">
        <strong>${employee.full_name}</strong>
        <div class="email">${employee.email}</div>
      </div>
    </td>
    <td>${employee.department}</td>
    <td>${employee.designation}</td>
    <td>${formatExperience(employee.experience_years)}</td>
    <td>${formatCurrency(employee.salary)}</td>
    <td>${formatDateOnly(employee.dob)}</td>
    <td>${formatDateOnly(employee.hire_date)}</td>
    <td>${formatDate(employee.created_at)}</td>
    <td class="table__actions">
      <button type="button" class="action-button action-button--edit" data-action="edit">Edit</button>
      <button type="button" class="action-button action-button--delete" data-action="delete">Delete</button>
    </td>
  `;
    return tr;
};

const setFeedback = (node, message, type) => {
    if (!node) return;
    node.textContent = message;
    node.hidden = !message;
    node.classList.toggle("feedback--error", type === "error");
    node.classList.toggle("feedback--success", type === "success");
};

const feedbackTimers = new WeakMap();

const showTransientFeedback = (node, message, type, duration = 2000) => {
    if (!node) return;
    if (feedbackTimers.has(node)) {
        clearTimeout(feedbackTimers.get(node));
    }

    setFeedback(node, message, type);

    if (duration > 0) {
        const timeoutId = setTimeout(() => {
            setFeedback(node, "", type);
            feedbackTimers.delete(node);
        }, duration);
        feedbackTimers.set(node, timeoutId);
    }
};

const resetForm = () => {
    if (!form) return;
    form.reset();
    clearFieldErrors(form);
    form.elements["full_name"].focus();
};

const resetEditForm = () => {
    if (!editForm) return;
    editForm.reset();
    activeEmployeeId = null;
    setFeedback(editFeedback, "", "success");
    clearFieldErrors(editForm);
};

const toggleModal = (modal, shouldOpen) => {
    if (!modal) return;

    if (shouldOpen) {
        modal.classList.add("is-open");
        document.body.classList.add("modal-open");
        return;
    }

    modal.classList.remove("is-open");
    if (!document.querySelector(".modal.is-open")) {
        document.body.classList.remove("modal-open");
    }

    if (modal === editModal) {
        resetEditForm();
    }

    if (modal === deleteModal) {
        state.pendingDelete = null;
    }
};

const loadEmployees = async () => {
    try {
        const response = await fetch("/api/employees");
        if (!response.ok) {
            throw new Error("Failed to load employees");
        }

        const { employees } = await response.json();
        state.employees = Array.isArray(employees) ? employees : [];
        renderEmployees();
    } catch (error) {
        const message = error.message.includes('fetch') ? "Unable to load employees. Please check your connection." : error.message;
        const feedbackNode = rosterFeedback || formFeedback;
        if (feedbackNode) {
            setFeedback(feedbackNode, message, "error");
        }
    }
};

const populateEditForm = (employee) => {
    if (!editForm || !employee) return;
    clearFieldErrors(editForm);
    const entries = {
        full_name: employee.full_name || "",
        email: employee.email || "",
        department: employee.department || "",
        designation: employee.designation || "",
        experience_years: employee.experience_years ?? "",
        salary: employee.salary ?? "",
        dob: employee.dob || "",
        hire_date: employee.hire_date || "",
    };

    Object.entries(entries).forEach(([name, value]) => {
        const field = editForm.elements.namedItem(name);
        if (field) {
            field.value = value ?? "";
        }
    });

    const firstField = editForm.elements.namedItem("full_name");
    if (firstField instanceof HTMLElement) {
        firstField.focus();
    }
    setFeedback(editFeedback, "", "success");
};

const handleEditClick = async (employeeId) => {
    if (!editForm) return;
    setFeedback(editFeedback, "", "success");

    try {
        const response = await fetch(`/api/employees/${employeeId}`);
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || "Unable to fetch employee");
        }

        const { employee } = result;
        activeEmployeeId = employee.id;
        populateEditForm(employee);
        toggleModal(editModal, true);
    } catch (error) {
        const message = error.message.includes('fetch') ? "Unable to fetch employee details. Please check your connection." : error.message;
        setFeedback(rosterFeedback || formFeedback, message, "error");
        createToast(message, "error", 4000);
    }
};

const handleDeleteClick = (employeeId) => {
    if (!deleteModal) return;
    const employee = state.employees.find((item) => item.id === employeeId);
    if (!employee) return;

    state.pendingDelete = employee;
    if (deleteMessage) {
        deleteMessage.textContent = `Remove ${employee.full_name} from the roster?`;
    }
    toggleModal(deleteModal, true);
};

if (form) {
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        setFeedback(formFeedback, "", "success");

        const { payload, isValid } = validateAndBuildPayload(form);
        if (!isValid) {
            setFeedback(formFeedback, "Please resolve the highlighted fields.", "error");
            return;
        }

        try {
            const response = await fetch("/api/employees", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || "Unable to save employee");
            }

            upsertEmployee(result.employee);
            renderEmployees();
            await refreshAnalytics();

            createToast("Employee saved successfully!", "success");
            resetForm();
            setFeedback(formFeedback, "", "success");
        } catch (error) {
            const message = error.message.includes('fetch') ? "Unable to save employee. Please check your connection." : error.message;
            setFeedback(formFeedback, message, "error");
            createToast(message, "error", 4000);
        }
    });
}

if (tableBody) {
    tableBody.addEventListener("click", async (event) => {
        const actionButton = event.target.closest("[data-action]");
        if (!actionButton) return;

        const row = actionButton.closest("tr");
        const employeeId = row?.dataset.employeeId;
        if (!employeeId) return;

        if (actionButton.dataset.action === "edit") {
            handleEditClick(employeeId);
        }

        if (actionButton.dataset.action === "delete") {
            handleDeleteClick(employeeId);
        }
    });
}

if (editForm) {
    editForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!activeEmployeeId) {
            setFeedback(editFeedback, "No employee selected for editing.", "error");
            return;
        }

        const { payload, isValid } = validateAndBuildPayload(editForm);
        if (!isValid) {
            setFeedback(editFeedback, "Please resolve the highlighted fields.", "error");
            return;
        }

        try {
            const response = await fetch(`/api/employees/${activeEmployeeId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || "Unable to update employee");
            }

            upsertEmployee(result.employee);
            renderEmployees();
            await refreshAnalytics();

            createToast("Employee updated successfully.", "success");
            toggleModal(editModal, false);
        } catch (error) {
            const message = error.message.includes('fetch') ? "Unable to update employee. Please check your connection." : error.message;
            setFeedback(editFeedback, message, "error");
            createToast(message, "error", 4000);
        }
    });
}

if (searchInput) {
    searchInput.addEventListener("input", (event) => {
        const raw = event.target.value || "";
        state.filters.searchRaw = raw;
        state.filters.search = raw.trim().toLowerCase();
        renderEmployees();
    });
}

if (departmentFilter) {
    departmentFilter.addEventListener("change", (event) => {
        state.filters.department = event.target.value || "";
        renderEmployees();
    });
}

const extractFilename = (contentDisposition) => {
    if (!contentDisposition) return null;
    const match = contentDisposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
    if (!match) return null;
    return decodeURIComponent(match[1] || match[2] || "").replace(/\s+/g, "_");
};

if (exportButton) {
    exportButton.addEventListener("click", async () => {
        exportButton.disabled = true;
        try {
            const response = await fetch("/api/employees/export");
            if (!response.ok) {
                let errorMessage = "Unable to export employees.";
                try {
                    const data = await response.json();
                    if (data?.error) errorMessage = data.error;
                } catch (error) {
                    // ignore JSON parse errors
                }
                throw new Error(errorMessage);
            }

            const blob = await response.blob();
            const disposition = response.headers.get("Content-Disposition");
            const filename = extractFilename(disposition) || `brightcode_employees_${Date.now()}.csv`;

            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            createToast("CSV export started.", "success");
        } catch (error) {
            const message = error.message.includes('fetch') ? "Unable to export employees. Please check your connection." : error.message;
            createToast(message, "error", 4000);
        } finally {
            exportButton.disabled = false;
        }
    });
}

document.querySelectorAll("[data-modal-close]").forEach((button) => {
    button.addEventListener("click", () => {
        const modal = button.closest(".modal");
        toggleModal(modal, false);
    });
});

document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            toggleModal(modal, false);
        }
    });
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        const openModalElement = document.querySelector(".modal.is-open");
        if (openModalElement) {
            toggleModal(openModalElement, false);
        }
    }
});

if (deleteConfirm) {
    deleteConfirm.addEventListener("click", async () => {
        const employee = state.pendingDelete;
        if (!employee) {
            toggleModal(deleteModal, false);
            return;
        }

        toggleModal(deleteModal, false);
        deleteConfirm.disabled = true;

        removeEmployeeFromState(employee.id);
        renderEmployees();

        try {
            const response = await fetch(`/api/employees/${employee.id}`, {
                method: "DELETE",
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || "Unable to delete employee");
            }

            createToast("Employee removed successfully.", "success");
            await refreshAnalytics();
        } catch (error) {
            upsertEmployee(employee);
            renderEmployees();
            const message = error.message.includes('fetch') ? "Unable to delete employee. Please check your connection." : error.message;
            createToast(message, "error", 4000);
        } finally {
            deleteConfirm.disabled = false;
        }
    });
}

// Dashboard Charts Implementation
const dashboardChartsScript = document.getElementById("chart-data");
const departmentCanvas = document.getElementById("departmentChart");
const salaryTrendsCanvas = document.getElementById("salaryTrendsChart");
const headcountCanvas = document.getElementById("headcountChart");
const averageSalaryTrendCanvas = document.getElementById("averageSalaryTrendChart");

const dashboardState = {
    chartData: parseInitialData(dashboardChartsScript) || {},
    charts: {
        department: null,
        salaryTrends: null,
        headcount: null,
        averageSalaryTrend: null
    },
    currentMetric: 'headcount'
};

// Sample data matching the image
const defaultChartData = {
    departmentDistribution: {
        headcount: {
            labels: ['Development', 'Design', 'HR', 'Marketing', 'Sales'],
            data: [35, 18, 12, 15, 20],
            colors: ['#110b3d', '#6a4d8b', '#114b5f', '#474973', '#8b7aa8', '#4d4c46']
        },
        avgSalary: {
            labels: ['Development', 'Design', 'HR', 'Marketing', 'Sales'],
            data: [85000, 65000, 55000, 60000, 70000],
            colors: ['#110b3d', '#6a4d8b', '#114b5f', '#474973', '#8b7aa8', '#4d4c46']
        }
    },
    salaryTrends: {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
        datasets: [
            {
                label: 'Development',
                data: [75000, 78000, 80000, 82000, 84000, 85000],
                borderColor: '#110b3d',
                backgroundColor: 'rgba(17, 11, 61, 0.1)',
                tension: 0.3
            },
            {
                label: 'Design',
                data: [55000, 58000, 60000, 62000, 64000, 65000],
                borderColor: '#6a4d8b',
                backgroundColor: 'rgba(106, 77, 139, 0.1)',
                tension: 0.3
            },
            {
                label: 'HR',
                data: [45000, 48000, 50000, 52000, 54000, 55000],
                borderColor: '#114b5f',
                backgroundColor: 'rgba(17, 75, 95, 0.1)',
                tension: 0.3
            },
            {
                label: 'Marketing',
                data: [50000, 53000, 56000, 58000, 59000, 60000],
                borderColor: '#474973',
                backgroundColor: 'rgba(71, 73, 115, 0.1)',
                tension: 0.3
            },
            {
                label: 'Sales',
                data: [60000, 63000, 65000, 67000, 69000, 70000],
                borderColor: '#8b7aa8',
                backgroundColor: 'rgba(139, 122, 168, 0.1)',
                tension: 0.3
            }
        ]
    }
};

const createDepartmentLegend = (data, colors) => {
    const legendContainer = document.getElementById("departmentLegend");
    if (!legendContainer) return;

    const total = data.reduce((sum, value) => sum + value, 0);
    legendContainer.innerHTML = '';

    data.forEach((value, index) => {
        const percentage = ((value / total) * 100).toFixed(0);
        const legendItem = document.createElement('div');
        legendItem.className = 'legend-item';
        legendItem.innerHTML = `
            <div class="legend-color" style="background-color: ${colors[index]}"></div>
            <span class="legend-label">${dashboardState.chartData.departmentDistribution?.headcount?.labels[index] || ''}</span>
            <span class="legend-value">${percentage}%</span>
        `;
        legendContainer.appendChild(legendItem);
    });
};

const renderDepartmentChart = () => {
    if (!window.Chart || !departmentCanvas) return;

    const data = dashboardState.chartData.departmentDistribution || defaultChartData.departmentDistribution;
    const currentData = data[dashboardState.currentMetric];

    if (dashboardState.charts.department) {
        dashboardState.charts.department.data.datasets[0].data = currentData.data;
        dashboardState.charts.department.update();
        createDepartmentLegend(currentData.data, currentData.colors);
    } else {
        dashboardState.charts.department = new Chart(departmentCanvas, {
            type: 'doughnut',
            data: {
                labels: currentData.labels,
                datasets: [{
                    data: currentData.data,
                    backgroundColor: currentData.colors,
                    borderWidth: 0,
                    cutout: '70%'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const total = context.dataset.data.reduce((sum, val) => sum + val, 0);
                                const percentage = ((context.parsed / total) * 100).toFixed(0);
                                return `${context.label}: ${percentage}%`;
                            }
                        }
                    }
                }
            }
        });
        createDepartmentLegend(currentData.data, currentData.colors);
    }
};

const renderSalaryTrendsChart = () => {
    if (!window.Chart || !salaryTrendsCanvas) return;

    const data = dashboardState.chartData.salaryTrends || defaultChartData.salaryTrends;

    if (dashboardState.charts.salaryTrends) {
        dashboardState.charts.salaryTrends.data = data;
        dashboardState.charts.salaryTrends.update();
    } else {
        dashboardState.charts.salaryTrends = new Chart(salaryTrendsCanvas, {
            type: 'line',
            data: data,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            usePointStyle: true,
                            padding: 15
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                label += new Intl.NumberFormat('en-US', {
                                    style: 'currency',
                                    currency: 'USD',
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: 0
                                }).format(context.parsed.y);
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        min: 50000,
                        max: 90000,
                        ticks: {
                            callback: (value) => {
                                return new Intl.NumberFormat('en-US', {
                                    style: 'currency',
                                    currency: 'USD',
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: 0
                                }).format(value);
                            }
                        }
                    }
                }
            }
        });
    }
};

const renderHeadcountChart = () => {
    if (!window.Chart || !headcountCanvas) return;

    const data = dashboardState.chartData.departmentDistribution?.headcount || defaultChartData.departmentDistribution.headcount;

    if (dashboardState.charts.headcount) {
        dashboardState.charts.headcount.data.labels = data.labels;
        dashboardState.charts.headcount.data.datasets[0].data = data.data;
        dashboardState.charts.headcount.update();
    } else {
        dashboardState.charts.headcount = new Chart(headcountCanvas, {
            type: 'bar',
            data: {
                labels: data.labels,
                datasets: [{
                    label: 'Headcount',
                    data: data.data,
                    backgroundColor: data.colors,
                    borderRadius: 8,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                return `Headcount: ${context.parsed.y}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0
                        }
                    }
                }
            }
        });
    }
};

const renderAverageSalaryTrendChart = () => {
    if (!window.Chart || !averageSalaryTrendCanvas) return;

    const data = dashboardState.chartData.departmentDistribution?.avgSalary || defaultChartData.departmentDistribution.avgSalary;

    if (dashboardState.charts.averageSalaryTrend) {
        dashboardState.charts.averageSalaryTrend.data.labels = data.labels;
        dashboardState.charts.averageSalaryTrend.data.datasets[0].data = data.data;
        dashboardState.charts.averageSalaryTrend.update();
    } else {
        dashboardState.charts.averageSalaryTrend = new Chart(averageSalaryTrendCanvas, {
            type: 'line',
            data: {
                labels: data.labels,
                datasets: [{
                    label: 'Average Salary',
                    data: data.data,
                    borderColor: ["#110b3d", "#6a4d8b", "#114b5f", "#474973", "#8b7aa8", "#4d4c46"],
                    backgroundColor: 'rgba(125, 79, 80, 0.1)',
                    borderWidth: 3,
                    tension: 0.3,
                    fill: true,
                    pointBackgroundColor: ["#110b3d", "#6a4d8b", "#114b5f", "#474973", "#8b7aa8", "#4d4c46"],
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: 6,
                    pointHoverRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                return new Intl.NumberFormat('en-US', {
                                    style: 'currency',
                                    currency: 'USD',
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: 0
                                }).format(context.parsed.y);
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        ticks: {
                            callback: (value) => {
                                return new Intl.NumberFormat('en-US', {
                                    style: 'currency',
                                    currency: 'USD',
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: 0
                                }).format(value);
                            }
                        }
                    }
                }
            }
        });
    }
};

const initializeDashboardCharts = () => {
    // Use provided data or default data
    if (!dashboardState.chartData || Object.keys(dashboardState.chartData).length === 0) {
        dashboardState.chartData = defaultChartData;
    }

    // Render all charts
    renderHeadcountChart();
    renderAverageSalaryTrendChart();
    renderDepartmentChart();
    renderSalaryTrendsChart();

    // Toggle button functionality
    const toggleButtons = document.querySelectorAll('.toggle-btn');
    toggleButtons.forEach(button => {
        button.addEventListener('click', () => {
            toggleButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            dashboardState.currentMetric = button.dataset.metric;
            renderDepartmentChart();
        });
    });
};

// Initialize dashboard charts if on dashboard page
if (departmentCanvas || salaryTrendsCanvas || headcountCanvas || averageSalaryTrendCanvas) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeDashboardCharts);
    } else {
        initializeDashboardCharts();
    }
}

updateSummaryCards();
renderDepartmentCharts();
loadEmployees();
