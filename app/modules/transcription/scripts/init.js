(function (angular, _) {
    'use strict';

    var module = angular.module('transcription', [
        'ui.router',
        'angularSpinner'
    ]);

    module.config(function ($stateProvider) {
        $stateProvider
            .state('transcription', {
                url: '/transcription/:subject_set_id/',
                views: {
                    main: {
                        controller: 'transcriptionCtrl',
                        templateUrl: 'templates/transcription/transcription.html'
                    }
                }
            });
    });

    module.service('pendingAnnotationsService', ['zooAPI', function(zooAPI) {
        this.get = function(subjectSet, page) {
            // Fetch current user's incomplete classifications
            return zooAPI.type('classifications/incomplete').get({
                page: page || 1,
                project_id: subjectSet.links.project
            }).then(function(annotations) {
                // Filter them to the current subject set
                return Promise.all(annotations.map(function (annotation) {
                    annotation.metadata.subjects = [];
                    var subjectId = annotation.links.subjects[0];
                    return zooAPI.type('set_member_subjects').get({ subject_id: subjectId })
                        .then(function(sets) {
                            var setsMatching = sets.filter(function(set) {
                                return set.links.subject_set === subjectSet.id;
                            });
                            if (setsMatching.length) {
                                // Subject in set; keep
                                return Promise.resolve(annotation);
                            } else {
                                // Subject not in set; discard
                                return Promise.resolve(false);
                            }
                        });
                }));
            }).then(function(annotationsFiltered) {
                // Strip out false values from promise result
                return Promise.resolve(annotationsFiltered.filter(annotation => annotation));
            })
            .catch(function(err) {
                throw err;
            });
        };
    }]);

    module.controller('transcriptionCtrl', function ($rootScope, $q, $timeout, $scope, $sce, $stateParams, zooAPI, zooAPISubjectSets, localStorageService, svgPanZoomFactory, pendingAnnotationsService) {
        $rootScope.bodyClass = 'transcribe';

        function zoomToCurrentAnnotation() {
            if ($scope.annotations && $scope.annotations.length > 0) {
                var annotation = $scope.annotations[0];
                var obj = svgPanZoomFactory.zoomToRect(annotation);

                $scope.uiPositionTop = (obj.sizes.height / 2) + ((annotation.height * obj.sizes.realZoom) / 2);
                $scope.annotationContent = $scope.annotations[0].content;
            }
        }

        window.zoomToCurrentAnnotation = zoomToCurrentAnnotation;

        var subject_set_id = $stateParams.subject_set_id;
        $scope.isLoading = true;
        zooAPISubjectSets.get({id: subject_set_id})
            .then(function (response) {
                $scope.ship = response[0];
                return pendingAnnotationsService.get($scope.ship);
            })
            .then(function (annotations_for_subject_set) {

                $scope.showAllAnnotations = false;

                var load_next = function () {
                    $scope.subjectImage = null;
                    $scope.isLoading = true;

                    if (annotations_for_subject_set.length > 0) {
                        var annotation = annotations_for_subject_set[0];
                        $scope.subject_id = annotation.links.subjects[0];
                        annotations_for_subject_set.shift();

                        $scope.annotations = annotation.annotations;
                        $scope.classification = annotation;

                        // Our best friend $timeout is back. Used here to delay setting
                        // of first / last until the $$hashKey has been set.
                        $timeout(function() {
                            $scope.first = $scope.annotations[0].$$hashKey;
                            $scope.last = $scope.annotations[$scope.annotations.length - 1].$$hashKey;
                        }, 0);

                        // This is presumably to allow saving of header rows, but this
                        // feature never got implemented. I'm not quite sure why there
                        // are separate entries for rows and cells (possibly to create
                        // subsequent rows off the columns), but we want to be able to
                        // transcribe the header cells for now.
                        // _.remove($scope.annotations, {type: 'header'});

                        _.remove($scope.annotations, {type: 'row'});

                        zooAPI.type('subjects').get({id: $scope.subject_id})
                            .then(function (response) {
                                var subject = response[0];
                                var keys = Object.keys(subject.locations[0]);
                                var subjectImage = subject.locations[0][keys[0]];
                                subjectImage += '?' + new Date().getTime();
                                $timeout(function () {
                                    $scope.subjectImage = $sce.trustAsResourceUrl(subjectImage);
                                    $scope.loadHandler = $scope.subjectLoaded();
                                }, 0);
                            });
                    } else {
                        $scope.annotations = null;
                        $scope.isLoading = false;
                    }
                };

                load_next();

                $scope.$watch('annotations', zoomToCurrentAnnotation, true);

                $scope.subjectLoaded = function () {
                    $scope.isLoading = false;
                    // Image is loaded, we can safely calculate zoom for first annotation
                    $timeout(zoomToCurrentAnnotation, 0);
                };

                $scope.prevAnnotation = function () {
                    $scope.save();
                    $scope.annotations.unshift($scope.annotations.pop());
                };

                $scope.nextAnnotation = function () {
                    $scope.save();
                    $scope.annotations.push($scope.annotations.shift());
                };

                $scope.save = function () {
                    $scope.annotations[0].content = $scope.annotationContent;
                    $scope.annotationContent = null;
                };

                $scope.toggleAllAnnotations = function () {
                    $scope.showAllAnnotations = true;
                    $scope.panZoom.fit();
                    $scope.panZoom.center();
                };

                var annotationInput = document.getElementById('annotation-input');

                $scope.insertChar = function (insertValue) {
                    var input = annotationInput;
                    if (document.selection) {
                        input.focus();
                        document.selection.createRange().text = insertValue;
                    } else if (input.selectionStart || input.selectionStart === '0') {
                        var endPos = input.selectionStart + 1;
                        input.value = input.value.substring(0, input.selectionStart) + insertValue + input.value.substring(input.selectionEnd, input.value.length);
                        input.selectionStart = endPos;
                        input.selectionEnd = endPos;
                        input.focus();
                    } else {
                        input.value += insertValue;
                    }
                };

                $scope.finish = function () {
                    $scope.save();
                    $scope.classification.update({
                      completed: true, // otherwise classification remains incomplete!
                      annotations: $scope.annotations,
                      metadata: {
                          started_at: new Date().toISOString(),
                          finished_at: new Date().toISOString(),
                          user_agent: navigator.userAgent,
                          user_language: navigator.language
                      }
                    });

                    $scope.classification.save()
                        .then(function (response) {
                            $scope.$apply(load_next);
                        });
                };
        });
    });

}(window.angular, window._));
