let surveyTable;
const surveyModal = new bootstrap.Modal(document.getElementById('surveyModal'));
const uploadModal = new bootstrap.Modal(document.getElementById('uploadModal'));

function escapeHtml(value) {
    return $('<div>').text(value || '').html();
}

function statusClass(status) {
    if (status === 'Active') return 'status-active';
    if (status === 'Expired') return 'status-expired';
    if (status === 'Upcoming') return 'status-upcoming';
    return 'status-unknown';
}

function resetSurveyForm() {
    $('#surveyForm')[0].reset();
    $('#surveyId').val('');
}

function loadSurveys() {
    $.getJSON('/api/surveys', function(response) {
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
        order: [[2, 'asc']],
        autoWidth: false,
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
                render: function() {
                    return `
                        <div class="action-btns">
                            <button class="btn btn-sm btn-outline-primary edit-survey">Edit</button>
                            <button class="btn btn-sm btn-outline-success upload-assignments">Upload CSV</button>
                        </div>
                    `;
                }
            }
        ]
    });

    loadSurveys();

    $('#addSurveyBtn').on('click', openAddSurveyModal);

    $('#surveysTable tbody').on('click', 'button.edit-survey', function() {
        const rowData = surveyTable.row($(this).closest('tr')).data();
        openEditSurveyModal(rowData);
    });

    $('#surveysTable tbody').on('click', 'button.upload-assignments', function() {
        const rowData = surveyTable.row($(this).closest('tr')).data();
        openUploadModal(rowData);
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
            url: surveyId ? `/api/surveys/${surveyId}` : '/api/surveys',
            method: surveyId ? 'PUT' : 'POST',
            contentType: 'application/json',
            data: JSON.stringify(payload)
        }).done(function(response) {
            surveyModal.hide();
            loadSurveys();
            console.error(response.message);
        }).fail(function(xhr) {
            console.error(xhr.responseJSON?.error || 'Failed to save survey.');
        });
    });

    $('#uploadForm').on('submit', function(e) {
        e.preventDefault();
        const surveyId = $('#uploadSurveyId').val();
        const file = $('#csvFile')[0].files[0];
        if (!file) {
            console.error('Please choose a CSV file.');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        $.ajax({
            url: `/api/surveys/${surveyId}/assignments/upload`,
            method: 'POST',
            data: formData,
            processData: false,
            contentType: false
        }).done(function(response) {
            uploadModal.hide();
            console.error(response.message);
        }).fail(function(xhr) {
            console.error(xhr.responseJSON?.error || 'Failed to upload CSV.');
        });
    });
});