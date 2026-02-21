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
                            backgroundColor: "rgba(125, 79, 80, 0.65)",
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
                            tension: 0.35,
                            borderColor: "rgba(96, 55, 60, 0.9)",
                            backgroundColor: "rgba(96, 55, 60, 0.18)",
                            fill: true,
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
        createToast(error.message, "error", 4000);
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
        createToast(error.message, "error", 4000);
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
            '<td class="table__empty" colspan="7">No employees match the current filters.</td>';
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
        const feedbackNode = rosterFeedback || formFeedback;
        if (feedbackNode) {
            setFeedback(feedbackNode, error.message, "error");
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
        setFeedback(rosterFeedback || formFeedback, error.message, "error");
        createToast(error.message, "error", 4000);
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
            setFeedback(formFeedback, error.message, "error");
            createToast(error.message, "error", 4000);
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
            setFeedback(editFeedback, error.message, "error");
            createToast(error.message, "error", 4000);
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
            createToast(error.message, "error", 4000);
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
            createToast(error.message, "error", 4000);
        } finally {
            deleteConfirm.disabled = false;
        }
    });
}

updateSummaryCards();
renderDepartmentCharts();
loadEmployees();
