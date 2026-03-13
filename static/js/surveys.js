let surveyTable;
const surveyModal = new bootstrap.Modal(document.getElementById('surveyModal'));
const uploadModal = new bootstrap.Modal(document.getElementById('uploadModal'));
const deleteConfirmModal = new bootstrap.Modal(document.getElementById('deleteConfirmModal'));
let pendingDeleteSurvey = null;

function escapeHtml(value) {
    return $('<div>').text(value || '').html();
}

function statusClass(status) {
    if (status === 'Active') return 'status-active';
    if (status === 'Expired') return 'status-expired';
    if (status === 'Upcoming') return 'status-upcoming';
    return 'status-unknown';
}

function showMessage(message, type = 'success') {
    let container = $('#messageContainer');

    if (!container.length) {
        container = $('<div id="messageContainer" class="mb-2"></div>');
        $('.page-wrap').first().prepend(container);
    }

    const alert = $(`
        <div class="alert alert-${type} alert-dismissible fade show" role="alert" tabindex="-1">
            ${escapeHtml(message)}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `);

    container.empty().append(alert);

    // Scroll to the message so the user sees the feedback
    if (container.offset()) {
        $('html, body').animate({
            scrollTop: container.offset().top - 20
        }, 300);
    }

    // Move keyboard focus to the message for accessibility
    setTimeout(function() {
        alert.focus();
    }, 100);
}

function resetSurveyForm() {
    $('#surveyForm')[0].reset();
    $('#surveyId').val('');
}

function loadSurveys() {
    $.getJSON('api/surveys', function(response) {
        surveyTable.clear();
        surveyTable.rows.add(response.data);
        surveyTable.draw();
    }).fail(function(xhr) {
        console.error(xhr.responseJSON?.error || 'Failed to load surveys.');
    });
}

function openAddSurveyModal() {
    resetSurveyForm();
    $('#surveyModalTitle').text('Add Survey');
    surveyModal.show();
}

function openEditSurveyModal(rowData) {
    $('#surveyModalTitle').text('Edit Survey');
    $('#surveyId').val(rowData.surveyId);
    $('#name').val(rowData.name || '');
    $('#description').val(rowData.description || '');
    $('#startDate').val(rowData.startDate || '');
    $('#endDate').val(rowData.endDate || '');
    surveyModal.show();
}

function openUploadModal(rowData) {
    $('#uploadSurveyId').val(rowData.surveyId);
    $('#uploadSurveyName').text(rowData.name);
    $('#csvFile').val('');
    uploadModal.show();
}

$(document).ready(function() {
    surveyTable = $('#surveysTable').DataTable({
        pageLength: 5,
        lengthChange: false,
        order: [[3, 'desc']],
        autoWidth: false,
        dom: '<"top d-flex justify-content-between align-items-center flex-wrap gap-2"f>rt<"bottom"ip><"clear">',
        columns: [
            { data: 'name' },
            {
                data: 'description',
                render: function(data) {
                    return '<div class="description-cell">' + escapeHtml(data || '') + '</div>';
                }
            },
            { data: 'startDate', defaultContent: '' },
            { data: 'endDate', defaultContent: '' },
            {
                data: 'status',
                render: function(data) {
                    return '<span class="status-pill ' + statusClass(data) + '">' + escapeHtml(data) + '</span>';
                }
            },
            {
                data: null,
                orderable: false,
                searchable: false,
                render: function(data, type, row) {
                    const disabled = row.status === 'Expired' ? 'disabled' : '';
                    const deleteDisabled = row.status !== 'Upcoming' ? 'disabled' : '';
                    return `
                        <div class="action-btns">
                            <button class="btn btn-sm btn-outline-primary edit-survey" ${disabled}>Edit</button>
                            <button class="btn btn-sm btn-outline-success upload-assignments" ${disabled}>Upload Links CSV</button>
                            <button class="btn btn-sm btn-outline-danger delete-survey" ${deleteDisabled}>Delete</button>
                        </div>
                    `;
                }
            }
        ]
    });

    loadSurveys();

    const filterContainer = $('#surveysTable_filter');
    const anchor = $('#tableControlsAnchor');
    if (filterContainer.length && anchor.length) {
        anchor.replaceWith(filterContainer);
    }

    $('#addSurveyBtn').on('click', openAddSurveyModal);

    $('#surveysTable tbody').on('click', 'button.edit-survey', function() {
        const rowData = surveyTable.row($(this).closest('tr')).data();
        openEditSurveyModal(rowData);
    });

    $('#surveysTable tbody').on('click', 'button.upload-assignments', function() {
        const rowData = surveyTable.row($(this).closest('tr')).data();
        openUploadModal(rowData);
    });

    $('#surveysTable tbody').on('click', 'button.delete-survey', function() {
        const rowData = surveyTable.row($(this).closest('tr')).data();
        if (!rowData || rowData.status !== 'Upcoming') {
            return;
        }

        pendingDeleteSurvey = rowData;
        $('#confirmDeleteBtn').data('surveyId', rowData.surveyId);
        $('#deleteConfirmModal .modal-body .mb-0').text(`Are you sure you want to delete survey "${rowData.name}"?`);
        deleteConfirmModal.show();
    });

    $('#confirmDeleteBtn').on('click', function() {
        const surveyId = $(this).data('surveyId');
        if (!surveyId || !pendingDeleteSurvey) {
            return;
        }

        if (document.activeElement) {
            document.activeElement.blur();
        }

        $.ajax({
            url: `api/surveys/${surveyId}`,
            method: 'DELETE'
        }).done(function(response) {
            deleteConfirmModal.hide();
            pendingDeleteSurvey = null;
            $('#confirmDeleteBtn').removeData('surveyId');
            loadSurveys();
            showMessage(response.message || 'Survey deleted.', 'success');
        }).fail(function(xhr) {
            deleteConfirmModal.hide();
            pendingDeleteSurvey = null;
            $('#confirmDeleteBtn').removeData('surveyId');
            showMessage(xhr.responseJSON?.error || 'Failed to delete survey.', 'danger');
        });
    });

    $('#surveyForm').on('submit', function(e) {
        e.preventDefault();
        const surveyId = $('#surveyId').val();
        const payload = {
            name: $('#name').val().trim(),
            description: $('#description').val(),
            startDate: $('#startDate').val() || null,
            endDate: $('#endDate').val() || null
        };

        $.ajax({
            url: surveyId ? `api/surveys/${surveyId}` : 'api/surveys',
            method: surveyId ? 'PUT' : 'POST',
            contentType: 'application/json',
            data: JSON.stringify(payload)
        }).done(function(response) {
            if (document.activeElement) {
                document.activeElement.blur();
            }
            surveyModal.hide();
            loadSurveys();
            showMessage(response.message, 'success');
        }).fail(function(xhr) {
            showMessage(xhr.responseJSON?.error || 'Failed to save survey.', 'danger');
        });
    });

    $('#uploadForm').on('submit', function(e) {
        e.preventDefault();
        const surveyId = $('#uploadSurveyId').val();
        const file = $('#csvFile')[0].files[0];
        if (!file) {
            showMessage('Please choose a CSV file.', 'warning');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        $.ajax({
            url: `api/surveys/${surveyId}/assignments/upload`,
            method: 'POST',
            data: formData,
            processData: false,
            contentType: false
        }).done(function(response) {
            if (document.activeElement) {
                document.activeElement.blur();
            }
            uploadModal.hide();
            showMessage(response.message, 'success');
        }).fail(function(xhr) {
            showMessage(xhr.responseJSON?.error || 'Failed to upload CSV.', 'danger');
        });
    });
});